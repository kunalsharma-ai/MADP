import type {
  CapabilityFinding,
  ChangeQuery,
  ConnectorHealth,
  PanelCode,
  SourceAnswer,
  SourceChangePage,
  SourceDeletion,
  SourcePage,
  SourceRespondent,
} from '@madp/contracts';
import { AUDITED_CAPABILITIES } from './capabilities.js';
import {
  mapAnswerChange,
  mapAnswerMap,
  mapOption,
  mapTombstone,
  mapQuestion,
  mapQuestionnaire,
  mapUser,
  type RawAnswerChange,
  type RawOption,
  type RawTombstone,
  type RawProfile,
  type RawQuestion,
  type RawUser,
} from './mapping.js';
import { ConnectorError, type PanelConnector } from './types.js';

export interface PanelApiConfig {
  /** e.g. https://www.turn2opinion.com - the backend is reached through the panel's own gateway. */
  baseUrl: string;
  /**
   * Host header the panel backend uses as its tenant key (`setOrigin`: req.origin = req.headers.host).
   * Must match the `origin` value stored on that panel's records.
   */
  tenantHost: string;
  /** Bearer token for an authorised MADP integration account. Loaded from the secrets manager, never committed. */
  bearerToken: string;
  timeoutMs?: number;
  /** Minimum gap between requests, to stay polite to production. */
  minIntervalMs?: number;
  /** Retries for 408, 425, 429, 5xx, timeouts and network errors. Default 3. Never retries 401/403 or bad payloads. */
  maxRetries?: number;
  /** Base delay for exponential backoff with full jitter. Default 500 ms; capped at 30 s. Retry-After wins when sent. */
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Endpoint map per panel. Paths are those read in each repository; no endpoint is assumed to be shared. */
export interface EndpointMap {
  questions: string;
  option: (question: string) => string;
  questionnaires: string;
  /** Admin user list. Unpaginated in all three repos today. */
  users: string;
  /** Proposed, non-breaking addition (docs/API_CONTRACTS.md section 3). Used only when the panel ships it. */
  pagedMembers?: string;
  answers:
    | { method: 'GET'; path: (memberId: string) => string }
    | { method: 'POST'; path: (memberId: string) => string };
  /**
   * Changed-since feeds (admin only). Added to the T2O backend by kunalsharma-ai/turn2opinion#20; a backend
   * without that change answers 404, and MADP reports automatic sync as not available for the panel.
   */
  changes?: { members: string; answers: string; deletions: string };
}

/**
 * All three panels run the same T2O backend in production (separate tenants by Host header), so they share one
 * endpoint map. The MFR and MHO repositories contain different API code that is NOT deployed; see
 * docs/INTEGRATION_GAP_ANALYSIS.md section 3.
 */
const T2O_BACKEND_ENDPOINTS: EndpointMap = {
  questions: '/api/v1/question',
  option: (q) => `/api/v1/option/${encodeURIComponent(q)}`,
  questionnaires: '/api/v1/profile',
  users: '/api/v1/user',
  // POST /user/:user/profile-data also exists on this backend but is marked "under development" and returns
  // raw Answer documents, so the profile route is used.
  answers: { method: 'GET', path: (id) => `/api/v1/user/${encodeURIComponent(id)}/profile` },
  // routes/api/Changes.js (turn2opinion#20): ?cursor=&since=&limit= -> {items, cursor, more}
  changes: {
    members: '/api/v1/changes/members',
    answers: '/api/v1/changes/answers',
    deletions: '/api/v1/changes/deletions',
  },
};

export const ENDPOINTS: Record<PanelCode, EndpointMap> = {
  t2o: T2O_BACKEND_ENDPOINTS,
  mfr: T2O_BACKEND_ENDPOINTS,
  mho: T2O_BACKEND_ENDPOINTS,
};

const RETRYABLE_STATUS = new Set([408, 425, 429]);

class RetryableError extends Error {
  constructor(
    readonly error: ConnectorError,
    readonly retryAfterMs?: number,
  ) {
    super(error.message);
  }
}

/** Retry-After is either delta-seconds or an HTTP date. Capped at 60 s so one header cannot stall a run. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 60_000) : undefined;
}

interface Envelope<T> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
}

/**
 * Read-only HTTP connector for the shared panel backend. Only GET and read-style POST endpoints are
 * called. It is constructed only when live access for that panel has been explicitly approved
 * (see apps/api ConnectorRegistry and docs/SECURITY_PRIVACY.md section 4).
 */
export class PanelApiConnector implements PanelConnector {
  readonly mode = 'live' as const;
  private lastCall = 0;
  private cachedUsers: RawUser[] | null = null;

  constructor(
    readonly panel: PanelCode,
    private readonly cfg: PanelApiConfig,
    private readonly endpoints: EndpointMap = ENDPOINTS[panel],
  ) {
    if (!cfg.bearerToken) throw new ConnectorError('Missing integration credential', panel, 'not_authorised');
    // The panel backend derives its tenant from the Host header, so we must call it on the tenant's own
    // hostname rather than overriding Host. See docs/INTEGRATION_GAP_ANALYSIS.md G-04.
    if (new URL(cfg.baseUrl).host !== cfg.tenantHost) {
      throw new ConnectorError(
        `baseUrl host must equal tenantHost (${cfg.tenantHost})`,
        panel,
        'invalid_payload',
      );
    }
  }

  capabilities(): CapabilityFinding[] {
    return AUDITED_CAPABILITIES[this.panel];
  }

  private readonly sleep = (ms: number) =>
    this.cfg.sleep ? this.cfg.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms));

  /** Calls with retry and backoff. Exhausted retries surface the last error to the caller (and the DLQ). */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const max = this.cfg.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce<T>(method, path, body);
      } catch (e) {
        if (!(e instanceof RetryableError) || attempt >= max) {
          throw e instanceof RetryableError ? e.error : e;
        }
        const base = this.cfg.retryBaseMs ?? 500;
        const backoff = Math.min(30_000, base * 2 ** attempt * Math.random());
        await this.sleep(e.retryAfterMs ?? backoff);
      }
    }
  }

  private async callOnce<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const gap = (this.cfg.minIntervalMs ?? 250) - (Date.now() - this.lastCall);
    if (gap > 0) await this.sleep(gap);
    this.lastCall = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 15_000);
    try {
      const res = await (this.cfg.fetchImpl ?? fetch)(new URL(path, this.cfg.baseUrl), {
        method,
        signal: ctrl.signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.bearerToken}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = (await res.json().catch(() => null)) as Envelope<T> | null;
      if (RETRYABLE_STATUS.has(res.status) || res.status >= 500) {
        throw new RetryableError(
          new ConnectorError(
            `Source error ${res.status}: ${json?.message ?? 'retryable'}`,
            this.panel,
            'source_error',
          ),
          parseRetryAfter(res.headers.get('retry-after')),
        );
      }
      if (res.status === 401 || res.status === 403)
        throw new ConnectorError(
          `Source refused access (${res.status})`,
          this.panel,
          'not_authorised',
          res.status,
        );
      if (!json || json.status !== 'success') {
        throw new ConnectorError(
          `Source error ${res.status}: ${json?.message ?? 'invalid envelope'}`,
          this.panel,
          json ? 'source_error' : 'invalid_payload',
          res.status,
        );
      }
      return json.data as T;
    } catch (e) {
      if (e instanceof ConnectorError || e instanceof RetryableError) throw e;
      if ((e as Error).name === 'AbortError')
        throw new RetryableError(new ConnectorError('Source request timed out', this.panel, 'timeout'));
      throw new RetryableError(
        new ConnectorError(`Source request failed: ${(e as Error).message}`, this.panel, 'source_error'),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ConnectorHealth> {
    const started = Date.now();
    try {
      await this.call<unknown>('GET', this.endpoints.questionnaires);
      return {
        panel: this.panel,
        mode: 'live',
        state: 'healthy',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: 'Questionnaire endpoint reachable',
      };
    } catch (e) {
      return {
        panel: this.panel,
        mode: 'live',
        state: 'down',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: (e as Error).message,
      };
    }
  }

  async listQuestionnaires() {
    const data = await this.call<RawProfile[]>('GET', this.endpoints.questionnaires);
    return data.map((p) => mapQuestionnaire(this.panel, p));
  }

  async listQuestions() {
    const data = await this.call<RawQuestion[]>('GET', this.endpoints.questions);
    if (!Array.isArray(data))
      throw new ConnectorError('Question list is not an array', this.panel, 'invalid_payload');
    // A question without a name can't be addressed (its option route would be /option/), so it is skipped.
    return data.filter((q) => String(q?.name ?? '').trim()).map((q) => mapQuestion(this.panel, q));
  }

  async listOptions(sourceQuestionId: string) {
    const data = await this.call<RawOption[]>('GET', this.endpoints.option(sourceQuestionId));
    if (!Array.isArray(data))
      throw new ConnectorError(
        `Options for "${sourceQuestionId}" are not an array`,
        this.panel,
        'invalid_payload',
      );
    return data.map((o) => mapOption(this.panel, o));
  }

  async listRespondents(cursor: string | null, limit: number): Promise<SourcePage<SourceRespondent>> {
    if (this.endpoints.pagedMembers) {
      const q = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
      const data = await this.call<{ items: RawUser[]; nextCursor: string | null }>(
        'GET',
        `${this.endpoints.pagedMembers}?${q}`,
      );
      return { items: data.items.map((u) => mapUser(this.panel, u)), nextCursor: data.nextCursor };
    }
    // Fallback: the source only offers an unpaginated list. Fetch once per run, page locally.
    // GET, not POST: after the T2O member-access fix, POST /user answers a non-admin with their own referrals
    // (an empty list for an integration account), while GET /user refuses a non-admin with 403. A wrong
    // credential must fail loudly, not import zero members.
    this.cachedUsers ??= await this.call<RawUser[]>('GET', this.endpoints.users);
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    const slice = this.cachedUsers.slice(start, start + limit);
    const next = start + slice.length;
    return {
      items: slice.map((u) => mapUser(this.panel, u)),
      nextCursor: next < this.cachedUsers.length ? String(next) : null,
    };
  }

  async listAnswers(sourceMemberIds: string[], sourceQuestionIds: string[]): Promise<SourceAnswer[]> {
    const qs = new Set(sourceQuestionIds);
    const out: SourceAnswer[] = [];
    for (const id of sourceMemberIds) {
      const ep = this.endpoints.answers;
      const data =
        ep.method === 'GET'
          ? await this.call<Record<string, unknown>>('GET', ep.path(id))
          : await this.call<Record<string, unknown>>('POST', ep.path(id), { questions: sourceQuestionIds });
      out.push(...mapAnswerMap(this.panel, id, data ?? {}, qs));
    }
    return out;
  }

  /** One page of a changes feed. A 404 means the panel does not serve the feed (yet): kind 'not_supported'. */
  private async changePage<R, T>(
    feed: 'members' | 'answers' | 'deletions',
    q: ChangeQuery,
    map: (raw: R) => T | null,
  ): Promise<SourceChangePage<T>> {
    const path = this.endpoints.changes?.[feed];
    if (!path)
      throw new ConnectorError(`No ${feed} changes feed for ${this.panel}`, this.panel, 'not_supported');
    const params = new URLSearchParams({ limit: String(q.limit) });
    if (q.cursor) params.set('cursor', q.cursor);
    else if (q.since) params.set('since', q.since);
    let data: { items?: R[]; cursor?: string | null; more?: boolean };
    try {
      data = await this.call('GET', `${path}?${params}`);
    } catch (e) {
      if (e instanceof ConnectorError && e.httpStatus === 404)
        throw new ConnectorError(
          `${this.panel} does not serve ${path} yet (404)`,
          this.panel,
          'not_supported',
          404,
        );
      throw e;
    }
    if (!data || !Array.isArray(data.items))
      throw new ConnectorError(`Invalid ${feed} changes page`, this.panel, 'invalid_payload');
    return {
      items: data.items.map(map).filter((x): x is T => x !== null),
      cursor: data.cursor ?? q.cursor ?? null,
      more: data.more === true,
    };
  }

  memberChanges(q: ChangeQuery): Promise<SourceChangePage<SourceRespondent>> {
    return this.changePage<RawUser, SourceRespondent>('members', q, (u) => mapUser(this.panel, u));
  }

  answerChanges(q: ChangeQuery): Promise<SourceChangePage<SourceAnswer>> {
    return this.changePage<RawAnswerChange, SourceAnswer>('answers', q, (a) =>
      mapAnswerChange(this.panel, a),
    );
  }

  deletions(q: ChangeQuery): Promise<SourceChangePage<SourceDeletion>> {
    return this.changePage<RawTombstone, SourceDeletion>('deletions', q, (t) => mapTombstone(this.panel, t));
  }
}
