import { CAPABILITY_IDS, type Capability } from './capabilities.js';
import { makeDiscovery } from './discovery.js';
import { matchOperation } from './operations.js';
import { verifySigned } from './signing.js';

/**
 * A small in-memory panel that implements the contract, as a `fetch` function. It is the executable example for
 * panel teams, the target the conformance kit is tested against, and a stand-in panel in MADP's own tests.
 * Its data is DEMO data only (`demo-` ids, `@example.invalid` e-mails).
 *
 * `faults` switch off one rule at a time, so tests can show that the kit catches it.
 */
export interface ReferencePanelOptions {
  brands?: string[];
  syncToken?: string;
  adminSecret?: string;
  capabilities?: readonly Capability[];
  now?: () => number;
  faults?: {
    acceptReplay?: boolean;
    acceptStale?: boolean;
    noAuth?: boolean;
    ignoreSince?: boolean;
    stuckCursor?: boolean;
    badQuestions?: boolean;
    htmlNotFound?: boolean;
  };
}

const DEMO_QUESTIONS = [
  {
    _id: 'demo-q1',
    name: 'GENDER',
    label: 'Gender',
    type: 'single',
    category: ['b2c'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    _id: 'demo-q2',
    name: 'COUNTRY',
    label: 'Country',
    type: 'single',
    category: ['b2c'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];
const DEMO_OPTIONS: Record<string, { question: string; label: string; value: string }[]> = {
  GENDER: [
    { question: 'GENDER', label: 'Female', value: 'female' },
    { question: 'GENDER', label: 'Male', value: 'male' },
  ],
  COUNTRY: [{ question: 'COUNTRY', label: 'India', value: 'IN' }],
};
const DEMO_PROFILES = [
  { slug: 'basic', name: 'Basic profile', category: 'b2c', pages: [['GENDER', 'COUNTRY']], points: 10 },
];
const DEMO_MEMBERS = [1, 2, 3].map((n) => ({
  _id: `demo-m${n}`,
  category: 'b2c',
  mail: `demo-member-${n}@example.invalid`,
  gender: n % 2 ? 'female' : 'male',
  address: [{ country: 'IN' }],
  isActive: true,
  terms: ['privacy'],
  createdAt: `2026-01-0${n}T00:00:00.000Z`,
  updatedAt: `2026-01-0${n}T00:00:00.000Z`,
}));
const DEMO_ANSWERS = DEMO_MEMBERS.map((m, i) => ({
  _id: `demo-a${i + 1}`,
  user: m._id,
  question: 'GENDER',
  answer: m.gender,
  updatedAt: m.updatedAt,
}));
const FEEDS: Record<string, { _id: string; updatedAt?: string; at?: string; [k: string]: unknown }[]> = {
  changesMembers: DEMO_MEMBERS,
  changesAnswers: DEMO_ANSWERS,
  changesDeletions: [{ _id: 'demo-t1', kind: 'answers', user: 'demo-m3', at: '2026-01-04T00:00:00.000Z' }],
  changesRewards: [
    {
      _id: 'demo-r1',
      user: 'demo-m1',
      category: 'survey',
      points: 50,
      status: 'approved',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  changesResponses: [
    {
      _id: 'demo-s1',
      user: 'demo-m1',
      survey: 'demo-survey',
      status: 'complete',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => json(200, { status: 'success', data });
const err = (status: number, code: string, message: string) =>
  json(status, { status: 'error', code, message });

export function createReferencePanel(opts: ReferencePanelOptions = {}): typeof fetch {
  const brands = opts.brands ?? ['www.demo-panel.example'];
  const caps = new Set<Capability>(
    opts.capabilities ?? CAPABILITY_IDS.filter((c) => c !== 'special_category'),
  );
  const seen = new Set<string>();
  const f = opts.faults ?? {};
  const now = () => opts.now?.() ?? Date.now();

  return (async (input: URL | string | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init?.body === 'string' ? init.body : '';
    const pathQ = url.pathname + url.search;

    const m = matchOperation(method, url.pathname);
    if (!m || !caps.has(m.op.capability))
      return f.htmlNotFound
        ? new Response('<h1>Not found</h1>', { status: 404, headers: { 'content-type': 'text/html' } })
        : err(404, 'not_found', 'No such route');
    const { op, params } = m;

    // authentication
    let origin: string | null = null;
    if (!f.noAuth) {
      const bearer = headers.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : null;
      const signedTry = headers['x-madp-signature'] !== undefined;
      const bearerOk = Boolean(bearer && opts.syncToken && bearer === opts.syncToken);
      if ((op.auth === 'bearer' || op.auth === 'either') && bearerOk) {
        /* fine */
      } else if ((op.auth === 'signed' || op.auth === 'either') && signedTry && opts.adminSecret) {
        const v = verifySigned({
          secret: opts.adminSecret,
          headers,
          method,
          path: pathQ,
          body,
          now: f.acceptStale ? Number(headers['x-madp-timestamp']) * 1000 : now(),
          seen: (n) => {
            if (seen.has(n) && !f.acceptReplay) return true;
            seen.add(n);
            return false;
          },
        });
        if (!v.ok) return err(v.status, v.code, v.message);
        if (!brands.includes(v.origin)) return err(403, 'admin_auth', 'Unknown or missing brand origin');
        origin = v.origin;
      } else return err(401, 'not_authorised', 'Credentials missing or wrong');
    }

    if (op.writes) return ok({ ok: true, dryRun: true });
    switch (op.resource) {
      case 'contract':
        return ok(
          makeDiscovery({
            brands: origin ? [origin] : brands,
            capabilities: [...caps],
            implementation: { name: 'madp-reference-panel', version: '1.0.0' },
          }),
        );
      case 'question':
        return ok(f.badQuestions ? DEMO_QUESTIONS.map(({ name: _n, ...q }) => q) : DEMO_QUESTIONS);
      case 'option':
        return ok(DEMO_OPTIONS[params.question!] ?? []);
      case 'profile':
        return ok(DEMO_PROFILES);
      case 'user':
        return ok(DEMO_MEMBERS);
      case 'userProfile': {
        const mine = DEMO_ANSWERS.filter((a) => a.user === params.id);
        if (!DEMO_MEMBERS.some((u) => u._id === params.id)) return err(404, 'not_found', 'No such member');
        return ok(Object.fromEntries(mine.map((a) => [a.question, a.answer])));
      }
      default:
        break;
    }
    const feed = FEEDS[op.resource];
    if (feed) {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 1000);
      const since = url.searchParams.get('since');
      const cursor = url.searchParams.get('cursor');
      let rows = feed;
      if (since && !f.ignoreSince) rows = rows.filter((r) => (r.updatedAt ?? r.at ?? '') >= since);
      const start = cursor && !f.stuckCursor ? Number(cursor) : 0;
      const items = rows.slice(start, start + limit);
      const next = start + items.length;
      return ok({ items, cursor: String(next), more: next < rows.length });
    }
    // other admin reads: an empty list, or an empty object for single records
    return ok(op.answer === 'adminList' ? [] : {});
  }) as typeof fetch;
}
