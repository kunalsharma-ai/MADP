import type { CapabilityFinding, ConnectorHealth, PanelCode, SourceAnswer, SourcePage, SourceRespondent } from '@madp/contracts';
import { AUDITED_CAPABILITIES } from './capabilities.js';
import { mapAnswerMap, mapOption, mapQuestion, mapQuestionnaire, mapUser, type RawOption, type RawProfile, type RawQuestion, type RawUser } from './mapping.js';
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
  fetchImpl?: typeof fetch;
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
  answers: { method: 'GET'; path: (memberId: string) => string } | { method: 'POST'; path: (memberId: string) => string };
}

export const ENDPOINTS: Record<PanelCode, EndpointMap> = {
  t2o: {
    questions: '/api/v1/question',
    option: (q) => `/api/v1/option/${encodeURIComponent(q)}`,
    questionnaires: '/api/v1/profile',
    users: '/api/v1/user',
    answers: { method: 'GET', path: (id) => `/api/v1/user/${encodeURIComponent(id)}/profile` },
  },
  mfr: {
    questions: '/api/v1/question',
    option: (q) => `/api/v1/option/${encodeURIComponent(q)}`,
    questionnaires: '/api/v1/profile',
    users: '/api/v1/user',
    answers: { method: 'POST', path: (id) => `/api/v1/user/${encodeURIComponent(id)}/profile-data` },
  },
  mho: {
    questions: '/api/v1/question',
    option: (q) => `/api/v1/option/${encodeURIComponent(q)}`,
    questionnaires: '/api/v1/profile',
    users: '/api/v1/user',
    answers: { method: 'POST', path: (id) => `/api/v1/user/${encodeURIComponent(id)}/profile-data` },
  },
};

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
      throw new ConnectorError(`baseUrl host must equal tenantHost (${cfg.tenantHost})`, panel, 'invalid_payload');
    }
  }

  capabilities(): CapabilityFinding[] {
    return AUDITED_CAPABILITIES[this.panel];
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const gap = (this.cfg.minIntervalMs ?? 250) - (Date.now() - this.lastCall);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
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
      if (res.status === 401 || res.status === 403) throw new ConnectorError(`Source refused access (${res.status})`, this.panel, 'not_authorised');
      if (!json || json.status !== 'success') {
        throw new ConnectorError(`Source error ${res.status}: ${json?.message ?? 'invalid envelope'}`, this.panel, json ? 'source_error' : 'invalid_payload');
      }
      return json.data as T;
    } catch (e) {
      if (e instanceof ConnectorError) throw e;
      if ((e as Error).name === 'AbortError') throw new ConnectorError('Source request timed out', this.panel, 'timeout');
      throw new ConnectorError(`Source request failed: ${(e as Error).message}`, this.panel, 'source_error');
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ConnectorHealth> {
    const started = Date.now();
    try {
      await this.call<unknown>('GET', this.endpoints.questionnaires);
      return { panel: this.panel, mode: 'live', state: 'healthy', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, message: 'Questionnaire endpoint reachable' };
    } catch (e) {
      return { panel: this.panel, mode: 'live', state: 'down', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, message: (e as Error).message };
    }
  }

  async listQuestionnaires() {
    const data = await this.call<RawProfile[]>('GET', this.endpoints.questionnaires);
    return data.map((p) => mapQuestionnaire(this.panel, p));
  }

  async listQuestions() {
    const data = await this.call<RawQuestion[]>('GET', this.endpoints.questions);
    return data.map((q) => mapQuestion(this.panel, q));
  }

  async listOptions(sourceQuestionId: string) {
    const data = await this.call<RawOption[]>('GET', this.endpoints.option(sourceQuestionId));
    return data.map((o) => mapOption(this.panel, o));
  }

  async listRespondents(cursor: string | null, limit: number): Promise<SourcePage<SourceRespondent>> {
    if (this.endpoints.pagedMembers) {
      const q = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
      const data = await this.call<{ items: RawUser[]; nextCursor: string | null }>('GET', `${this.endpoints.pagedMembers}?${q}`);
      return { items: data.items.map((u) => mapUser(this.panel, u)), nextCursor: data.nextCursor };
    }
    // Fallback: the source only offers an unpaginated list. Fetch once per run, page locally.
    this.cachedUsers ??= await this.call<RawUser[]>('POST', this.endpoints.users, {});
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    const slice = this.cachedUsers.slice(start, start + limit);
    const next = start + slice.length;
    return { items: slice.map((u) => mapUser(this.panel, u)), nextCursor: next < this.cachedUsers.length ? String(next) : null };
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
}
