import type { z } from 'zod';
import { CAPABILITIES, type Capability, type CapabilityInfo } from './capabilities.js';
import { checkDiscovery, type Discovery } from './discovery.js';
import { ADMIN_OPERATIONS, SYNC_OPERATIONS, fillPath, pathOf, type Operation } from './operations.js';
import {
  AdminList,
  AnswerRecord,
  ChangePage,
  ErrorEnvelope,
  MemberAnswerMap,
  MemberRecord,
  OptionRecord,
  ProfileRecord,
  QuestionRecord,
  ResponseRecord,
  RewardRecord,
  TombstoneRecord,
} from './records.js';
import { signedHeaders } from './signing.js';
import { CONTRACT_VERSION_HEADER, PANEL_CONTRACT_VERSION } from './version.js';

/**
 * The conformance kit. Any panel team runs it against their backend (`madp-panel-conformance`), and MADP runs it from
 * Panel connections. It only reads: no route that writes is ever called. Routes that return personal data are probed
 * only with `allowPersonalData` (the owner's live approval for that panel), with `limit` 1 or 2, and nothing they
 * return is kept: the report holds counts and problems, never records.
 */
export interface ConformanceOptions {
  baseUrl: string;
  /** Bearer token for the read and sync routes. */
  syncToken?: string;
  /** Shared secret of the signed admin routes. */
  adminSecret?: string;
  /** The brand hostname to sign for. Required with `adminSecret`. */
  origin?: string;
  allowPersonalData?: boolean;
  /** False for a backend that serves only the signed admin API (core capabilities are then checked elsewhere). */
  requireCore?: boolean;
  fetchImpl?: typeof fetch;
  /** Milliseconds. Injected in tests. */
  now?: () => number;
  timeoutMs?: number;
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  capability?: Capability;
}

export interface ConformanceReport {
  contract: string;
  baseHost: string;
  startedAt: string;
  finishedAt: string;
  /** True when no check failed. Skipped checks don't count against it. */
  conformant: boolean;
  counts: Record<CheckStatus, number>;
  discovery: Pick<Discovery, 'version' | 'implementation' | 'brands' | 'capabilities'> | null;
  results: CheckResult[];
}

interface Answer {
  status: number;
  json: unknown;
  location: string | null;
}

const ACTOR = '00000000-0000-4000-8000-00000000c0de';

export async function runConformance(o: ConformanceOptions): Promise<ConformanceReport> {
  const startedAt = new Date(o.now?.() ?? Date.now()).toISOString();
  const results: CheckResult[] = [];
  const add = (r: CheckResult) => results.push(r);
  const doFetch = o.fetchImpl ?? fetch;
  const now = () => o.now?.() ?? Date.now();

  async function send(
    path: string,
    auth: 'none' | 'bearer' | 'signed' | { bearer: string } | { headers: Record<string, string> },
  ): Promise<Answer> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      [CONTRACT_VERSION_HEADER]: PANEL_CONTRACT_VERSION,
    };
    if (auth === 'bearer') headers.authorization = `Bearer ${o.syncToken}`;
    else if (auth === 'signed')
      Object.assign(
        headers,
        signedHeaders(o.adminSecret!, {
          method: 'GET',
          path,
          origin: o.origin!,
          actor: ACTOR,
          body: '',
          now: now(),
        }),
      );
    else if (typeof auth === 'object' && 'bearer' in auth) headers.authorization = `Bearer ${auth.bearer}`;
    else if (typeof auth === 'object') Object.assign(headers, auth.headers);
    try {
      const res = await doFetch(new URL(path, o.baseUrl), {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
      });
      const json = await res.json().catch(() => undefined);
      return { status: res.status, json, location: res.headers.get('location') };
    } catch (e) {
      return { status: 0, json: undefined, location: null, ...{ error: (e as Error).message } };
    }
  }

  const refused = (a: Answer) => a.status === 401 || a.status === 403;
  const isRedirect = (a: Answer) => a.status >= 300 && a.status < 400;
  const data = (a: Answer) => (a.json as { data?: unknown } | undefined)?.data;
  const success = (a: Answer) =>
    a.status === 200 && (a.json as { status?: string } | undefined)?.status === 'success';
  const problem = (s: z.ZodType, v: unknown) => {
    const r = s.safeParse(v);
    return r.success
      ? null
      : r.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || 'data'}: ${i.message}`)
          .join('; ');
  };
  const describe = (a: Answer) =>
    a.status === 0
      ? 'not reachable'
      : `HTTP ${a.status}${(a.json as { message?: string } | undefined)?.message ? `: ${String((a.json as { message: string }).message).slice(0, 120)}` : ''}`;

  // ---- 1. discovery --------------------------------------------------------------------------------------------
  const discoveryPath = pathOf('sync', 'contract');
  const discoveryAuth = o.syncToken ? 'bearer' : o.adminSecret && o.origin ? 'signed' : null;
  let discovery: Discovery | null = null;
  let declared = new Set<Capability>();
  if (!discoveryAuth) {
    add({
      id: 'discovery.answers',
      title: 'Discovery answers',
      status: 'fail',
      detail: 'Give a sync token or an admin secret with an origin',
    });
  } else {
    const a = await send(discoveryPath, discoveryAuth);
    if (isRedirect(a)) {
      add({
        id: 'discovery.answers',
        title: 'Discovery answers',
        status: 'fail',
        detail: `Redirected to ${a.location ?? '?'}: a panel API must not redirect`,
      });
    } else if (!success(a)) {
      add({
        id: 'discovery.answers',
        title: 'Discovery answers',
        status: 'fail',
        detail: `GET ${discoveryPath}: ${describe(a)}`,
      });
    } else {
      const c = checkDiscovery(data(a), { requireCore: o.requireCore !== false });
      discovery = c.discovery ?? null;
      declared = new Set(c.capabilities);
      add({
        id: 'discovery.answers',
        title: 'Discovery answers',
        status: c.ok ? 'pass' : 'fail',
        detail: c.ok
          ? `Contract ${discovery!.version}, ${c.capabilities.length} capabilities${c.unknown.length ? ` (+${c.unknown.length} unknown, ignored)` : ''}`
          : c.problems.join('; '),
      });
      if (o.origin && discovery)
        add({
          id: 'discovery.origin',
          title: 'Brand is served',
          status: discovery.brands.some((b) => b.origin === o.origin) ? 'pass' : 'fail',
          detail: `${o.origin} ${discovery.brands.some((b) => b.origin === o.origin) ? 'is' : 'is not'} in brands (${discovery.brands.map((b) => b.origin).join(', ')})`,
        });
    }
  }

  // ---- 2. authentication ---------------------------------------------------------------------------------------
  {
    const a = await send(discoveryPath, 'none');
    add({
      id: 'auth.required',
      title: 'A call without credentials is refused',
      status: refused(a) ? 'pass' : 'fail',
      detail: `GET ${discoveryPath} without credentials: ${describe(a)} (want 401 or 403)`,
    });
  }
  if (o.syncToken) {
    const a = await send(discoveryPath, { bearer: `${o.syncToken}x` });
    add({
      id: 'auth.bearer.wrong',
      title: 'A wrong token is refused',
      status: refused(a) ? 'pass' : 'fail',
      detail: `${describe(a)} (want 401 or 403)`,
    });
  }
  if (o.adminSecret && o.origin) {
    const sign = (over: { secret?: string; now?: number; origin?: string } = {}) =>
      signedHeaders(over.secret ?? o.adminSecret!, {
        method: 'GET',
        path: discoveryPath,
        origin: over.origin ?? o.origin!,
        actor: ACTOR,
        body: '',
        now: over.now ?? now(),
      });
    const good = sign();
    const first = await send(discoveryPath, { headers: good });
    add({
      id: 'auth.signed.valid',
      title: 'A signed call is accepted',
      status: success(first) ? 'pass' : 'fail',
      detail: describe(first),
    });
    const replay = await send(discoveryPath, { headers: good });
    add({
      id: 'auth.signed.replay',
      title: 'A replayed nonce is refused',
      status: refused(replay) || replay.status === 409 ? 'pass' : 'fail',
      detail: `Same headers sent twice: ${describe(replay)} (want 409, or 401)`,
    });
    const wrong = await send(discoveryPath, { headers: sign({ secret: `${o.adminSecret}x` }) });
    add({
      id: 'auth.signed.wrong_secret',
      title: 'A wrong secret is refused',
      status: refused(wrong) ? 'pass' : 'fail',
      detail: describe(wrong),
    });
    const stale = await send(discoveryPath, { headers: sign({ now: now() - 600_000 }) });
    add({
      id: 'auth.signed.stale',
      title: 'An old timestamp is refused',
      status: refused(stale) ? 'pass' : 'fail',
      detail: `Timestamp 10 minutes old: ${describe(stale)}`,
    });
    const swapped = { ...sign(), 'x-madp-origin': `other.${o.origin}` };
    const tampered = await send(discoveryPath, { headers: swapped });
    add({
      id: 'auth.signed.origin',
      title: 'Changing the brand header breaks the signature',
      status: refused(tampered) ? 'pass' : 'fail',
      detail: describe(tampered),
    });
  }

  // ---- 3. errors -----------------------------------------------------------------------------------------------
  if (discoveryAuth) {
    const a = await send('/api/v1/madp-contract-probe-unknown-route', discoveryAuth);
    const envelope = ErrorEnvelope.safeParse(a.json).success;
    add({
      id: 'errors.not_found',
      title: 'An unknown route answers 404 with the error envelope',
      status: a.status === 404 ? (envelope ? 'pass' : 'warn') : 'fail',
      detail:
        a.status === 404
          ? envelope
            ? '404 {status:"error", message}'
            : '404 without the {status:"error", message} envelope'
          : describe(a),
    });
  }

  // ---- 4. read and sync routes ---------------------------------------------------------------------------------
  const personal = (c: Capability) => Boolean((CAPABILITIES[c] as CapabilityInfo).personal);
  const gate = (op: Operation): string | null => {
    if (!declared.has(op.capability)) return 'not declared';
    if (personal(op.capability) && !o.allowPersonalData)
      return 'returns personal data: run with live approval to probe it';
    return null;
  };
  let firstQuestion: string | null = null;
  let firstMember: string | null = null;
  const feedItem: Record<string, z.ZodType> = {
    changesMembers: MemberRecord,
    changesAnswers: AnswerRecord,
    changesDeletions: TombstoneRecord,
    changesRewards: RewardRecord,
    changesResponses: ResponseRecord,
  };
  if (o.syncToken) {
    for (const op of SYNC_OPERATIONS) {
      if (op.resource === 'contract') continue;
      const title = `${op.method} ${op.path}`;
      const why = gate(op);
      if (why) {
        add({ id: `sync.${op.resource}`, title, status: 'skip', detail: why, capability: op.capability });
        continue;
      }
      let path: string;
      if (op.resource === 'option') {
        if (!firstQuestion) {
          add({
            id: `sync.${op.resource}`,
            title,
            status: 'skip',
            detail: 'No question to ask options for',
            capability: op.capability,
          });
          continue;
        }
        path = fillPath(op.path, { question: firstQuestion });
      } else if (op.resource === 'userProfile') {
        if (!firstMember) {
          add({
            id: `sync.${op.resource}`,
            title,
            status: 'skip',
            detail: 'No member id seen in the member feed',
            capability: op.capability,
          });
          continue;
        }
        path = fillPath(op.path, { id: firstMember });
      } else if (op.answer === 'changes') path = `${op.path}?limit=2`;
      else path = op.path;
      const a = await send(path, 'bearer');
      if (!success(a)) {
        add({
          id: `sync.${op.resource}`,
          title,
          status: 'fail',
          detail: `${describe(a)}${a.status === 404 ? ' (declared but not served)' : ''}`,
          capability: op.capability,
        });
        continue;
      }
      const d = data(a);
      let issue: string | null = null;
      let note = '';
      if (op.answer === 'questions') {
        issue = Array.isArray(d) ? problem(QuestionRecord.array(), d) : 'data is not an array';
        if (!issue) {
          firstQuestion = (d as { name: string }[])[0]?.name ?? null;
          note = `${(d as unknown[]).length} questions`;
        }
      } else if (op.answer === 'options') {
        issue = Array.isArray(d) ? problem(OptionRecord.array(), d) : 'data is not an array';
        if (!issue) note = `${(d as unknown[]).length} options for "${firstQuestion}"`;
      } else if (op.answer === 'profiles') {
        issue = Array.isArray(d) ? problem(ProfileRecord.array(), d) : 'data is not an array';
        if (!issue) note = `${(d as unknown[]).length} questionnaires`;
      } else if (op.answer === 'members') {
        issue = Array.isArray(d) ? null : 'data is not an array';
        if (!issue && !firstMember && (d as { _id?: unknown }[])[0]?._id)
          firstMember = String((d as { _id: unknown }[])[0]!._id);
        if (!issue) note = `${(d as unknown[]).length} members (records not kept)`;
      } else if (op.answer === 'answerMap') {
        issue = problem(MemberAnswerMap, d);
        if (!issue) note = 'answers keyed by question name';
      } else if (op.answer === 'changes') {
        issue = problem(ChangePage(feedItem[op.resource]!), d);
        if (!issue) {
          const page = d as { items: { _id: unknown }[]; cursor?: string | null; more?: boolean };
          note = `${page.items.length} item(s) on the first page, more: ${page.more === true}`;
          if (op.resource === 'changesMembers' && page.items[0]) firstMember = String(page.items[0]._id);
          if (page.more && !page.cursor) issue = '`more` is true but there is no cursor';
          if (!issue && page.more && page.cursor) {
            const next = await send(`${op.path}?limit=2&cursor=${encodeURIComponent(page.cursor)}`, 'bearer');
            const p2 = data(next) as { items?: { _id: unknown }[] } | undefined;
            if (!success(next) || !Array.isArray(p2?.items)) issue = `second page: ${describe(next)}`;
            else if (p2.items.some((i) => page.items.some((j) => String(j._id) === String(i._id))))
              issue = 'the second page repeats an item of the first: the cursor does not move';
            else note += '; the cursor moves to a new page';
          }
          if (!issue) {
            const future = await send(
              `${op.path}?limit=2&since=${encodeURIComponent('2999-01-01T00:00:00.000Z')}`,
              'bearer',
            );
            const pf = data(future) as { items?: unknown[] } | undefined;
            if (!success(future) || !Array.isArray(pf?.items)) issue = `since=2999: ${describe(future)}`;
            else if (pf.items.length) issue = 'since a future date still returns items: `since` is ignored';
          }
        }
      }
      add({
        id: `sync.${op.resource}`,
        title,
        status: issue ? 'fail' : 'pass',
        detail: issue ?? note,
        capability: op.capability,
      });
    }
  } else {
    add({ id: 'sync', title: 'Read and sync routes', status: 'skip', detail: 'No sync token given' });
  }

  // ---- 5. signed admin routes (reads only) ---------------------------------------------------------------------
  if (o.adminSecret && o.origin) {
    for (const op of ADMIN_OPERATIONS) {
      if (op.method !== 'GET' || op.path.includes('{') || op.resource === 'qbExport') continue;
      const title = `GET ${op.path}`;
      const why = gate(op);
      if (why) {
        add({ id: `admin.${op.resource}`, title, status: 'skip', detail: why, capability: op.capability });
        continue;
      }
      const path = op.query?.includes('limit') ? `${op.path}?limit=1` : op.path;
      const a = await send(path, 'signed');
      const issue = !success(a)
        ? `${describe(a)}${a.status === 404 ? ' (declared but not served)' : ''}`
        : op.answer === 'adminList'
          ? problem(AdminList, data(a))
          : null;
      add({
        id: `admin.${op.resource}`,
        title,
        status: issue ? 'fail' : 'pass',
        detail: issue ?? 'success envelope (records not kept)',
        capability: op.capability,
      });
    }
  } else {
    add({
      id: 'admin',
      title: 'Signed admin routes',
      status: 'skip',
      detail: 'No admin secret and origin given',
    });
  }

  const counts: Record<CheckStatus, number> = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const r of results) counts[r.status]++;
  return {
    contract: PANEL_CONTRACT_VERSION,
    baseHost: new URL(o.baseUrl).host,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    conformant: counts.fail === 0,
    counts,
    discovery: discovery
      ? {
          version: discovery.version,
          implementation: discovery.implementation,
          brands: discovery.brands,
          capabilities: discovery.capabilities,
        }
      : null,
    results,
  };
}
