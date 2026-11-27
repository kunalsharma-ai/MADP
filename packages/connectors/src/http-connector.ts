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
import { isBuiltInPanel, type BuiltInPanelCode } from '@madp/contracts';
import { capabilitiesFor } from './capabilities.js';
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
import {
  CONTRACT_VERSION_HEADER,
  PANEL_CONTRACT_VERSION,
  checkDiscovery,
  pathOf,
  sign,
  type Capability,
  type DiscoveryCheck,
} from '@madp/panel-contract';

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
  /**
   * Capabilities the panel declared at GET /api/v1/contract. When set, a feed the panel did not declare is reported
   * as not supported without calling it. Unset (no discovery yet) means every route is tried.
   */
  declaredCapabilities?: readonly Capability[];
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
 * The read and sync routes of the MADP Panel API Contract (packages/panel-contract), which are the T2O backend's own
 * routes. All three panels run that backend in production (separate tenants by Host header), and any new panel that
 * follows the contract serves the same paths. The MFR and MHO repositories contain different API code that is NOT
 * deployed; see docs/INTEGRATION_GAP_ANALYSIS.md section 3.
 */
const T2O_BACKEND_ENDPOINTS: EndpointMap = {
  questions: pathOf('sync', 'question'),
  option: (q) => pathOf('sync', 'option', { question: q }),
  questionnaires: pathOf('sync', 'profile'),
  users: pathOf('sync', 'user'),
  // POST /user/:user/profile-data also exists on the T2O backend but is marked "under development" and returns raw
  // Answer documents, so the contract uses the profile route.
  answers: { method: 'GET', path: (id) => pathOf('sync', 'userProfile', { id }) },
  // ?cursor=&since=&limit= -> {items, cursor, more} (turn2opinion#20, #24)
  changes: {
    members: pathOf('sync', 'changesMembers'),
    answers: pathOf('sync', 'changesAnswers'),
    deletions: pathOf('sync', 'changesDeletions'),
    rewards: pathOf('sync', 'changesRewards'),
    responses: pathOf('sync', 'changesResponses'),
  },
};

/** The contract capability behind each changes feed. */
const FEED_CAPABILITY: Record<'members' | 'answers' | 'deletions' | 'rewards' | 'responses', Capability> = {
  members: 'changes.members',
  answers: 'changes.answers',
  deletions: 'changes.deletions',
  rewards: 'changes.rewards',
  responses: 'changes.responses',
};

/** Built-in panels. A panel added in the console runs on the same shared backend, so it uses these routes too. */
export const ENDPOINTS: Record<BuiltInPanelCode, EndpointMap> = {
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
/** Routes for a panel: its audited map, else the shared panel backend's. */
export function endpointsFor(panel: PanelCode): EndpointMap {
  return isBuiltInPanel(panel) ? ENDPOINTS[panel] : T2O_BACKEND_ENDPOINTS;
}

export class PanelApiConnector implements PanelConnector {
  readonly mode = 'live' as const;
  private lastCall = 0;
  private cachedUsers: RawUser[] | null = null;

  constructor(
    readonly panel: PanelCode,
    private readonly cfg: PanelApiConfig,
    private readonly endpoints: EndpointMap = endpointsFor(panel),
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
    return capabilitiesFor(this.panel);
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
        // A panel API never redirects. Refusing to follow one keeps the bearer token from being sent anywhere else.
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.bearerToken}`,
          [CONTRACT_VERSION_HEADER]: PANEL_CONTRACT_VERSION,
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

  /** Reads GET /api/v1/contract with the sync token and checks it. A 404 means the panel has no discovery route yet. */
  async discover(opts: { requireCore?: boolean } = {}): Promise<DiscoveryCheck & { httpStatus?: number }> {
    try {
      return checkDiscovery(await this.call<unknown>('GET', pathOf('sync', 'contract')), opts);
    } catch (e) {
      const status = e instanceof ConnectorError ? e.httpStatus : undefined;
      return {
        ok: false,
        capabilities: [],
        unknown: [],
        missingCore: [],
        problems: [status === 404 ? 'The panel does not serve GET /api/v1/contract yet (404)' : (e as Error).message],
        ...(status ? { httpStatus: status } : {}),
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
    const declared = this.cfg.declaredCapabilities;
    if (declared && !declared.includes(FEED_CAPABILITY[feed]))
      throw new ConnectorError(
        `${this.panel} does not declare ${FEED_CAPABILITY[feed]} in its API contract`,
        this.panel,
        'not_supported',
      );
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

const adm = (resource: string, params?: Record<string, string | number>) => pathOf('admin', resource, params);

/**
 * Signed admin routes of the MADP Panel API Contract. The paths come from packages/panel-contract (operations.ts), the
 * single list of panel routes; these typed helpers only fill them in. They were added to the shared backend by
 * kunalsharma-ai/MFR#44 (Project/api/app/admin/routes.js). The
 * shared backend image serves all three brands; the brand is the signed x-madp-origin header, never the Host header.
 */
export const PANEL_ADMIN_ROUTES = {
  members: adm('members'),
  member: (id: string) => adm('member', { id }),
  memberLedger: (id: string) => adm('memberLedger', { id }),
  memberStatus: (id: string) => adm('memberStatus', { id }),
  memberSegment: (id: string) => adm('memberSegment', { id }),
  memberUnmask: (id: string) => adm('memberUnmask', { id }),
  // Member actions (MFR#67, Project/api/app/admin/memberactions.js): e-mails behind email_admin_actions, "log in as member"
  memberResetPassword: (id: string) => adm('memberResetPassword', { id }),
  memberResendWelcome: (id: string) => adm('memberResendWelcome', { id }),
  memberLoginAs: (id: string) => adm('memberLoginAs', { id }),
  memberAdminSessions: (id: string) => adm('memberAdminSessions', { id }),
  memberAdminSessionEnd: (id: string, sid: string) => adm('memberAdminSessionEnd', { id, sid }),
  // Member engagement (MFR#101, Project/api/app/admin/memberengagement.js): what the member sees, alerts, payout method
  memberEngagement: (id: string) => adm('memberEngagement', { id }),
  memberResponses: (id: string) => adm('memberResponses', { id }),
  memberAlerts: (id: string) => adm('memberAlerts', { id }),
  memberPayoutClear: (id: string) => adm('memberPayoutClear', { id }),
  // Duplicate accounts (MFR#68, Project/api/app/admin/merge.js): find, merge (dry run unless ?dryRun=0), list, undo
  duplicates: adm('duplicates'),
  merge: adm('merge'),
  merges: adm('merges'),
  mergeUndo: (id: string) => adm('mergeUndo', { id }),
  archiveRun: adm('archiveRun'),
  restore: adm('restore'),
  qbExport: adm('qbExport'),
  qbImport: adm('qbImport'),
  qbRulesCheck: adm('qbRulesCheck'),
  questions: adm('questions'),
  question: (name: string) => adm('question', { name }),
  questionOptions: (name: string) => adm('questionOptions', { name }),
  profiles: adm('profiles'),
  profileCompletion: adm('profileCompletion'),
  profile: (id: string) => adm('profile', { id }),
  qbVersions: adm('qbVersions'),
  qbVersion: (n: number) => adm('qbVersion', { n }),
  qbVersionAction: (n: number, action: 'review' | 'publish' | 'discard') => adm('qbVersionAction', { n, action }),
  questionTranslations: (name: string) => adm('questionTranslations', { name }),
  missingTranslations: adm('missingTranslations'),
  segments: adm('segments'),
  segment: (name: string) => adm('segment', { name }),
  audienceCount: adm('audienceCount'),
  audiences: adm('audiences'),
  audience: (id: string) => adm('audience', { id }),
  audienceRecount: (id: string) => adm('audienceRecount', { id }),
  surveys: adm('surveys'),
  survey: (id: string) => adm('survey', { id }),
  surveyStatus: (id: string) => adm('surveyStatus', { id }),
  surveyFeasibility: (id: string) => adm('surveyFeasibility', { id }),
  surveyInvite: (id: string) => adm('surveyInvite', { id }),
  surveyResponses: (id: string) => adm('surveyResponses', { id }),
  surveyReconcile: (id: string) => adm('surveyReconcile', { id }),
  memberPoints: (id: string) => adm('memberPoints', { id }),
  pointsApprovals: adm('pointsApprovals'),
  pointsApproval: (id: string) => adm('pointsApproval', { id }),
  holds: adm('holds'),
  holdRelease: (id: string) => adm('holdRelease', { id }),
  qualityTiers: adm('qualityTiers'),
  qualityReview: adm('qualityReview'),
  memberQuality: (id: string) => adm('memberQuality', { id }),
  referralFraud: adm('referralFraud'),
  experts: adm('experts'),
  expert: (id: string) => adm('expert', { id }),
  expertDecision: (id: string) => adm('expertDecision', { id }),
  tickets: adm('tickets'),
  ticket: (id: string) => adm('ticket', { id }),
  ticketReply: (id: string) => adm('ticketReply', { id }),
  ticketStatus: (id: string) => adm('ticketStatus', { id }),
  messages: adm('messages'),
  message: (id: string) => adm('message', { id }),
  messagePreview: (id: string) => adm('messagePreview', { id }),
  messageSend: (id: string) => adm('messageSend', { id }),
  messageWithdraw: (id: string) => adm('messageWithdraw', { id }),
  help: adm('help'),
  helpEntry: (id: string) => adm('helpEntry', { id }),
  helpStatus: (id: string) => adm('helpStatus', { id }),
  // content and legal pages (MFR#64, turn2opinion#33, MHO#15: app/admin/content.js)
  content: adm('content'),
  contentPage: (id: string) => adm('contentPage', { id }),
  contentAction: (id: string, action: 'review' | 'publish' | 'discard') => adm('contentAction', { id, action }),
  contentRevisions: (id: string) => adm('contentRevisions', { id }),
  contentRevision: (id: string, version: number) => adm('contentRevision', { id, version }),
  contentRestore: (id: string, version: number) => adm('contentRestore', { id, version }),
  // step 4 (MFR backend app/admin/routes.js)
  switches: adm('switches'),
  switch: (key: string) => adm('switch', { key }),
  // auto reminders and WhatsApp / SMS providers (MFR#105, app/admin/reminders.js)
  reminders: adm('reminders'),
  remindersPreview: adm('remindersPreview'),
  channels: adm('channels'),
  channel: (c: string) => adm('channel', { channel: c }),
  channelCheck: (c: string) => adm('channelCheck', { channel: c }),
  channelRemove: (c: string) => adm('channelRemove', { channel: c }),
  // prize machines, one per segment (MFR#56)
  prizeMachines: adm('prizeMachines'),
  // step 5 reports, aggregate counts per brand (MFR#58)
  report: (name: string) => adm('report', { name }),
  prizeMachine: (segment: string) => adm('prizeMachine', { segment }),
  prizeMachinePlays: (segment: string) => adm('prizeMachinePlays', { segment }),
  catalogue: adm('catalogue'),
  catalogueItem: (key: string) => adm('catalogueItem', { key }),
  redemptions: adm('redemptions'),
  redemption: (id: string) => adm('redemption', { id }),
  redemptionDecision: (id: string) => adm('redemptionDecision', { id }),
  draws: adm('draws'),
  drawRun: (id: string) => adm('drawRun', { id }),
  drawCancel: (id: string) => adm('drawCancel', { id }),
  offers: adm('offers'),
  offerEnd: (id: string) => adm('offerEnd', { id }),
  tasks: adm('tasks'),
  task: (id: string) => adm('task', { id }),
  ideas: adm('ideas'),
  idea: (id: string) => adm('idea', { id }),
  stories: adm('stories'),
  story: (id: string) => adm('story', { id }),
  streaks: adm('streaks'),
  teens: adm('teens'),
  teen: (id: string) => adm('teen', { id }),
  teenRevokeLinks: (id: string) => adm('teenRevokeLinks', { id }),
  teenGraduate: (id: string) => adm('teenGraduate', { id }),
  // turning 18 not accepted within the time: close (MFR#55)
  teenClose: (id: string) => adm('teenClose', { id }),
  // registration pipeline: all eleven statuses; approve (manual review), cancel, renew (expired) (MFR#55)
  teenRegistrations: adm('teenRegistrations'),
  teenRegistrationAction: (id: string, action: 'approve' | 'cancel' | 'renew') => adm('teenRegistrationAction', { id, action }),
  dataRequests: adm('dataRequests'),
  dataRequest: (id: string) => adm('dataRequest', { id }),
  dataRequestDecision: (id: string) => adm('dataRequestDecision', { id }),} as const;

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
 * HMAC-SHA256 over `${timestamp}\n${nonce}\n${METHOD}\n${path+query}\n${origin}\n${actor}\n${sha256(body)}`, hex. The
 * same canonical string as the panel side (admin/auth.js). The nonce is new for every call and the panel accepts each
 * nonce once, so a copied request can't be sent again.
 */
export async function signPanelAdmin(
  secret: string,
  p: {
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    origin: string;
    actor: string;
    body: string;
  },
): Promise<string> {
  return sign(secret, p);
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
    const { randomBytes } = await import('node:crypto');
    const nonce = randomBytes(16).toString('hex');
    const signature = await signPanelAdmin(this.cfg.secret, {
      timestamp,
      nonce,
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
        // never follow a redirect: the signed headers must only ever reach the panel itself
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(raw ? { 'content-type': 'application/json' } : {}),
          'x-madp-timestamp': timestamp,
          'x-madp-nonce': nonce,
          'x-madp-origin': this.cfg.origin,
          'x-madp-actor': actor,
          'x-madp-signature': signature,
          [CONTRACT_VERSION_HEADER]: PANEL_CONTRACT_VERSION,
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

  /** Signed GET /api/v1/contract. A 404 means the panel has no discovery route yet. */
  async discover(actor: string, opts: { requireCore?: boolean } = {}): Promise<DiscoveryCheck & { httpStatus?: number }> {
    try {
      return checkDiscovery(await this.call<unknown>(actor, 'GET', pathOf('sync', 'contract')), opts);
    } catch (e) {
      const status = e instanceof PanelAdminError ? e.httpStatus : undefined;
      return {
        ok: false,
        capabilities: [],
        unknown: [],
        missingCore: [],
        problems: [status === 404 ? 'The panel does not serve GET /api/v1/contract yet (404)' : (e as Error).message],
        ...(status ? { httpStatus: status } : {}),
      };
    }
  }
}
