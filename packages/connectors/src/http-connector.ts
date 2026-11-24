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
  SourceResponse,
  SourceReward,
} from '@madp/contracts';
import { AUDITED_CAPABILITIES } from './capabilities.js';
import {
  mapAnswerChange,
  mapAnswerMap,
  mapOption,
  mapTombstone,
  mapResponse,
  mapReward,
  mapQuestion,
  mapQuestionnaire,
  mapUser,
  type RawAnswerChange,
  type RawOption,
  type RawTombstone,
  type RawProfile,
  type RawQuestion,
  type RawUser,
  type RawResponse,
  type RawReward,
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
  changes?: { members: string; answers: string; deletions: string; rewards?: string; responses?: string };
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
    // turn2opinion#24: reward rows and survey responses, same paging.
    rewards: '/api/v1/changes/rewards',
    responses: '/api/v1/changes/responses',
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
    feed: 'members' | 'answers' | 'deletions' | 'rewards' | 'responses',
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

  rewardChanges(q: ChangeQuery): Promise<SourceChangePage<SourceReward>> {
    return this.changePage<RawReward, SourceReward>('rewards', q, (r) => mapReward(this.panel, r));
  }

  responseChanges(q: ChangeQuery): Promise<SourceChangePage<SourceResponse>> {
    return this.changePage<RawResponse, SourceResponse>('responses', q, (r) => mapResponse(this.panel, r));
  }
}

// ---- Panel admin API (super admin console) ------------------------------------------------------------------------

/**
 * Routes of the panel backend's admin API, added by kunalsharma-ai/MFR#44 (Project/api/app/admin/routes.js). The
 * shared backend image serves all three brands; the brand is the signed x-madp-origin header, never the Host header.
 */
export const PANEL_ADMIN_ROUTES = {
  members: '/api/admin/v1/members',
  member: (id: string) => `/api/admin/v1/members/${encodeURIComponent(id)}`,
  memberLedger: (id: string) => `/api/admin/v1/members/${encodeURIComponent(id)}/ledger`,
  memberStatus: (id: string) => `/api/admin/v1/members/${encodeURIComponent(id)}/status`,
  memberSegment: (id: string) => `/api/admin/v1/members/${encodeURIComponent(id)}/segment`,
  memberUnmask: (id: string) => `/api/admin/v1/members/${encodeURIComponent(id)}/unmask`,
  archiveRun: '/api/admin/v1/members/archive-run',
  restore: '/api/admin/v1/members/restore',
  qbExport: '/api/admin/v1/qb/export',
  qbImport: '/api/admin/v1/qb/import',
  qbRulesCheck: '/api/admin/v1/qb/rules/check',
  questions: '/api/admin/v1/questions',
  question: (name: string) => `/api/admin/v1/questions/${encodeURIComponent(name)}`,
  questionOptions: (name: string) => `/api/admin/v1/questions/${encodeURIComponent(name)}/options`,
  profiles: '/api/admin/v1/profiles',
  profileCompletion: '/api/admin/v1/profiles/completion',
  profile: (id: string) => `/api/admin/v1/profiles/${encodeURIComponent(id)}`,
  qbVersions: '/api/admin/v1/qb/versions',
  qbVersion: (n: number) => `/api/admin/v1/qb/versions/${n}`,
  qbVersionAction: (n: number, action: 'review' | 'publish' | 'discard') =>
    `/api/admin/v1/qb/versions/${n}/${action}`,
  questionTranslations: (name: string) => `/api/admin/v1/questions/${encodeURIComponent(name)}/translations`,
  missingTranslations: '/api/admin/v1/qb/translations/missing',
  segments: '/api/admin/v1/segments',
  segment: (name: string) => `/api/admin/v1/segments/${encodeURIComponent(name)}`,
  audienceCount: '/api/admin/v1/audiences/count',
  audiences: '/api/admin/v1/audiences',
  audience: (id: string) => `/api/admin/v1/audiences/${encodeURIComponent(id)}`,
  audienceRecount: (id: string) => `/api/admin/v1/audiences/${encodeURIComponent(id)}/count`,
  surveys: '/api/admin/v1/surveys',
  survey: (id: string) => `/api/admin/v1/surveys/${encodeURIComponent(id)}`,
  surveyStatus: (id: string) => `/api/admin/v1/surveys/${encodeURIComponent(id)}/status`,
  surveyFeasibility: (id: string) => `/api/admin/v1/surveys/${encodeURIComponent(id)}/feasibility`,
  surveyInvite: (id: string) => `/api/admin/v1/surveys/${encodeURIComponent(id)}/invite`,
  surveyResponses: (id: string) => `/api/admin/v1/surveys/${encodeURIComponent(id)}/responses`,
  surveyReconcile: (id: string) => `/api/admin/v1/surveys/${encodeURIComponent(id)}/reconcile`,
  memberPoints: (id: string) => `/api/admin/v1/members/${encodeURIComponent(id)}/points`,
  pointsApprovals: '/api/admin/v1/points/approvals',
  pointsApproval: (id: string) => `/api/admin/v1/points/approvals/${encodeURIComponent(id)}`,
  holds: '/api/admin/v1/points/holds',
  holdRelease: (id: string) => `/api/admin/v1/points/holds/${encodeURIComponent(id)}/release`,
  qualityTiers: '/api/admin/v1/quality/tiers',
  qualityReview: '/api/admin/v1/quality/review',
  memberQuality: (id: string) => `/api/admin/v1/members/${encodeURIComponent(id)}/quality`,
  referralFraud: '/api/admin/v1/referrals/fraud',
  tickets: '/api/admin/v1/tickets',
  ticket: (id: string) => `/api/admin/v1/tickets/${encodeURIComponent(id)}`,
  ticketReply: (id: string) => `/api/admin/v1/tickets/${encodeURIComponent(id)}/reply`,
  ticketStatus: (id: string) => `/api/admin/v1/tickets/${encodeURIComponent(id)}/status`,
  messages: '/api/admin/v1/messages',
  message: (id: string) => `/api/admin/v1/messages/${encodeURIComponent(id)}`,
  messagePreview: (id: string) => `/api/admin/v1/messages/${encodeURIComponent(id)}/preview`,
  messageSend: (id: string) => `/api/admin/v1/messages/${encodeURIComponent(id)}/send`,
  messageWithdraw: (id: string) => `/api/admin/v1/messages/${encodeURIComponent(id)}/withdraw`,
  help: '/api/admin/v1/help',
  helpEntry: (id: string) => `/api/admin/v1/help/${encodeURIComponent(id)}`,
  helpStatus: (id: string) => `/api/admin/v1/help/${encodeURIComponent(id)}/status`,
  // step 4 (MFR backend app/admin/routes.js)
  switches: '/api/admin/v1/switches',
  switch: (key: string) => `/api/admin/v1/switches/${encodeURIComponent(key)}`,
  // prize machines, one per segment (MFR#56)
  prizeMachines: '/api/admin/v1/prize-machines',
  prizeMachine: (segment: string) => `/api/admin/v1/prize-machines/${encodeURIComponent(segment)}`,
  prizeMachinePlays: (segment: string) => `/api/admin/v1/prize-machines/${encodeURIComponent(segment)}/plays`,
  catalogue: '/api/admin/v1/rewards/catalogue',
  catalogueItem: (key: string) => `/api/admin/v1/rewards/catalogue/${encodeURIComponent(key)}`,
  redemptions: '/api/admin/v1/redemptions',
  redemption: (id: string) => `/api/admin/v1/redemptions/${encodeURIComponent(id)}`,
  redemptionDecision: (id: string) => `/api/admin/v1/redemptions/${encodeURIComponent(id)}/decision`,
  draws: '/api/admin/v1/draws',
  drawRun: (id: string) => `/api/admin/v1/draws/${encodeURIComponent(id)}/run`,
  drawCancel: (id: string) => `/api/admin/v1/draws/${encodeURIComponent(id)}/cancel`,
  offers: '/api/admin/v1/offers',
  offerEnd: (id: string) => `/api/admin/v1/offers/${encodeURIComponent(id)}/end`,
  tasks: '/api/admin/v1/engagement/tasks',
  task: (id: string) => `/api/admin/v1/engagement/tasks/${encodeURIComponent(id)}`,
  ideas: '/api/admin/v1/engagement/ideas',
  idea: (id: string) => `/api/admin/v1/engagement/ideas/${encodeURIComponent(id)}`,
  stories: '/api/admin/v1/engagement/stories',
  story: (id: string) => `/api/admin/v1/engagement/stories/${encodeURIComponent(id)}`,
  streaks: '/api/admin/v1/engagement/streaks',
  teens: '/api/admin/v1/teens',
  teen: (id: string) => `/api/admin/v1/teens/${encodeURIComponent(id)}`,
  teenRevokeLinks: (id: string) => `/api/admin/v1/teens/${encodeURIComponent(id)}/revoke-links`,
  teenGraduate: (id: string) => `/api/admin/v1/teens/${encodeURIComponent(id)}/graduate`,
  // turning 18 not accepted within the time: close (MFR#55)
  teenClose: (id: string) => `/api/admin/v1/teens/${encodeURIComponent(id)}/close`,
  // registration pipeline: all eleven statuses; approve (manual review), cancel, renew (expired) (MFR#55)
  teenRegistrations: '/api/admin/v1/teens/registrations',
  teenRegistrationAction: (id: string, action: 'approve' | 'cancel' | 'renew') =>
    `/api/admin/v1/teens/registrations/${encodeURIComponent(id)}/${action}`,
  dataRequests: '/api/admin/v1/data-requests',
  dataRequest: (id: string) => `/api/admin/v1/data-requests/${encodeURIComponent(id)}`,
  dataRequestDecision: (id: string) => `/api/admin/v1/data-requests/${encodeURIComponent(id)}/decision`,
} as const;

export interface PanelAdminConfig {
  baseUrl: string;
  /** The brand's hostname, as stored in `origin` on every record of that brand. */
  origin: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Thrown for an answer from the panel admin API that is not success. `code` is the panel's error code. */
export class PanelAdminError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * HMAC-SHA256 over `${timestamp}\n${METHOD}\n${path+query}\n${origin}\n${actor}\n${sha256(body)}`, hex. The same
 * canonical string as the panel side (admin/auth.js).
 */
export async function signPanelAdmin(
  secret: string,
  p: { timestamp: string; method: string; path: string; origin: string; actor: string; body: string },
): Promise<string> {
  const { createHash, createHmac } = await import('node:crypto');
  const bodyHash = createHash('sha256').update(p.body).digest('hex');
  const canonical = `${p.timestamp}\n${p.method.toUpperCase()}\n${p.path}\n${p.origin}\n${p.actor}\n${bodyHash}`;
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export class PanelAdminClient {
  constructor(
    readonly panel: PanelCode,
    private readonly cfg: PanelAdminConfig,
  ) {}

  async call<T>(
    actor: string,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown,
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {}))
      if (v !== undefined && v !== '') params.set(k, String(v));
    const full = params.size ? `${path}?${params}` : path;
    const raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = String(Math.floor((this.cfg.now?.() ?? Date.now()) / 1000));
    const signature = await signPanelAdmin(this.cfg.secret, {
      timestamp,
      method,
      path: full,
      origin: this.cfg.origin,
      actor,
      body: raw,
    });
    const doFetch = this.cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(new URL(full, this.cfg.baseUrl), {
        method,
        body: raw || undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
        headers: {
          accept: 'application/json',
          ...(raw ? { 'content-type': 'application/json' } : {}),
          'x-madp-timestamp': timestamp,
          'x-madp-origin': this.cfg.origin,
          'x-madp-actor': actor,
          'x-madp-signature': signature,
        },
      });
    } catch (e) {
      throw new PanelAdminError(
        `${this.panel} admin API unreachable: ${(e as Error).message}`,
        502,
        'unreachable',
      );
    }
    let json: { status?: string; data?: T; code?: string; message?: string } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* not JSON */
    }
    if (!res.ok || json.status !== 'success')
      throw new PanelAdminError(
        json.message ?? `${this.panel} admin API answered ${res.status}`,
        res.status,
        json.code ?? 'panel_error',
      );
    return json.data as T;
  }
}
