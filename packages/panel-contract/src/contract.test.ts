import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_OPERATIONS,
  CAPABILITY_IDS,
  CORE_CAPABILITIES,
  OPERATIONS,
  SHARED_BACKEND_CAPABILITIES,
  checkDiscovery,
  createReferencePanel,
  makeDiscovery,
  matchOperation,
  panelContractOpenApi,
  panelContractRoutesMarkdown,
  pathOf,
  runConformance,
  sign,
  signedHeaders,
  verifySigned,
} from './index.js';

const BASE = 'https://www.demo-panel.example';
const ORIGIN = 'www.demo-panel.example';
const TOKEN = 'demo-sync-token-0123456789abcdef';
const SECRET = 'demo-admin-secret-0123456789abcdef0123';
const NOW = 1_800_000_000_000;

const panel = (extra: Parameters<typeof createReferencePanel>[0] = {}) =>
  createReferencePanel({ brands: [ORIGIN], syncToken: TOKEN, adminSecret: SECRET, now: () => NOW, ...extra });
const run = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof runConformance>[0]> = {}) =>
  runConformance({
    baseUrl: BASE,
    syncToken: TOKEN,
    adminSecret: SECRET,
    origin: ORIGIN,
    allowPersonalData: true,
    fetchImpl,
    now: () => NOW,
    ...extra,
  });
const status = (r: Awaited<ReturnType<typeof run>>, id: string) => r.results.find((x) => x.id === id)?.status;

describe('operations table', () => {
  it('has unique ids and unique method + path pairs', () => {
    expect(new Set(OPERATIONS.map((o) => o.id)).size).toBe(OPERATIONS.length);
    expect(new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`)).size).toBe(OPERATIONS.length);
  });

  it('keeps every route under /api/v1, admin routes signed, and only GET as reads', () => {
    for (const o of OPERATIONS) {
      expect(o.path.startsWith('/api/v1/')).toBe(true);
      expect(o.writes).toBe(o.method !== 'GET');
    }
    for (const o of ADMIN_OPERATIONS) {
      expect(o.path.startsWith('/api/v1/admin/')).toBe(true);
      expect(o.auth).toBe('signed');
    }
  });

  it('gives every capability at least one route, except push-only ones', () => {
    for (const c of CAPABILITY_IDS) {
      if (c === 'webhooks.push' || c === 'special_category') continue;
      expect(
        OPERATIONS.some((o) => o.capability === c),
        c,
      ).toBe(true);
    }
  });

  it('matches literal segments before parameters', () => {
    expect(matchOperation('GET', '/api/v1/admin/members/duplicates?limit=5')?.op.id).toBe(
      'admin.duplicates.get',
    );
    expect(matchOperation('GET', '/api/v1/admin/members/merges')?.op.id).toBe('admin.merges.get');
    expect(matchOperation('GET', '/api/v1/admin/members/abc')?.op.id).toBe('admin.member.get');
    expect(matchOperation('GET', '/api/v1/admin/members/abc')?.params).toEqual({ id: 'abc' });
    expect(matchOperation('GET', '/api/v1/admin/teens/registrations')?.op.id).toBe(
      'admin.teenRegistrations.get',
    );
    expect(matchOperation('POST', '/api/v1/admin/content/terms/publish')?.op.id).toBe(
      'admin.contentAction.post',
    );
    expect(matchOperation('POST', '/api/v1/admin/content/terms/explode')).toBeNull();
    expect(matchOperation('DELETE', '/api/v1/admin/members/abc')).toBeNull();
    expect(matchOperation('GET', '/api/v1/option/a%20b')?.params).toEqual({ question: 'a b' });
  });

  it('fills and encodes path parameters', () => {
    expect(pathOf('admin', 'member', { id: 'a/b' })).toBe('/api/v1/admin/members/a%2Fb');
    expect(() => pathOf('admin', 'member')).toThrow(/Missing path parameter/);
    expect(() => pathOf('admin', 'nope')).toThrow(/Unknown admin resource/);
  });

  it('the shared backend offers every core capability', () => {
    for (const c of CORE_CAPABILITIES) expect(SHARED_BACKEND_CAPABILITIES).toContain(c);
  });
});

describe('discovery', () => {
  it('accepts a 1.x panel and ignores capabilities from a newer minor version', () => {
    const c = checkDiscovery({
      ...makeDiscovery({ brands: [ORIGIN] }),
      version: '1.4.0',
      capabilities: [...CORE_CAPABILITIES, 'future.thing'],
    });
    expect(c.ok).toBe(true);
    expect(c.unknown).toEqual(['future.thing']);
  });

  it('refuses another major version, a missing core capability and a bad shape', () => {
    expect(checkDiscovery(makeDiscovery({ brands: [ORIGIN], version: '2.0.0' })).ok).toBe(false);
    const missing = checkDiscovery(makeDiscovery({ brands: [ORIGIN], capabilities: ['questions.read'] }));
    expect(missing.ok).toBe(false);
    expect(missing.missingCore).toContain('changes.members');
    // an admin-only backend: core is checked on the union of the panel's backends instead
    expect(
      checkDiscovery(
        makeDiscovery({ brands: [ORIGIN], capabilities: ['contract.discovery', 'admin.members'] }),
        { requireCore: false },
      ).ok,
    ).toBe(true);
    expect(checkDiscovery({ contract: 'something-else' }).ok).toBe(false);
  });
});

describe('signing', () => {
  it('verifies a signed call once, and refuses replay, stale time, a wrong secret and a changed path', () => {
    const seen = new Set<string>();
    const remember = (n: string) => (seen.has(n) ? true : (seen.add(n), false));
    const h = signedHeaders(SECRET, {
      method: 'GET',
      path: '/api/v1/contract',
      origin: ORIGIN,
      actor: 'a',
      body: '',
      now: NOW,
    });
    const base = {
      secret: SECRET,
      headers: h,
      method: 'GET',
      path: '/api/v1/contract',
      body: '',
      now: NOW,
      seen: remember,
    };
    expect(verifySigned(base).ok).toBe(true);
    expect(verifySigned(base)).toMatchObject({ ok: false, status: 409, code: 'admin_auth' });
    const h2 = signedHeaders(SECRET, {
      method: 'GET',
      path: '/api/v1/contract',
      origin: ORIGIN,
      actor: 'a',
      body: '',
      now: NOW - 400_000,
    });
    expect(verifySigned({ ...base, headers: h2 }).ok).toBe(false);
    const h3 = signedHeaders(`${SECRET}x`, {
      method: 'GET',
      path: '/api/v1/contract',
      origin: ORIGIN,
      actor: 'a',
      body: '',
      now: NOW,
    });
    expect(verifySigned({ ...base, headers: h3 }).ok).toBe(false);
    const h4 = signedHeaders(SECRET, {
      method: 'GET',
      path: '/api/v1/contract',
      origin: ORIGIN,
      actor: 'a',
      body: '',
      now: NOW,
    });
    expect(verifySigned({ ...base, headers: h4, path: '/api/v1/question' }).ok).toBe(false);
  });

  it('uses the canonical string of the shared panel backend', () => {
    // Same vector as the panel side (MFR Project/api/app/admin/auth.js): any change here breaks every panel.
    const s = sign('k', {
      timestamp: '1',
      nonce: '0'.repeat(32),
      method: 'get',
      path: '/p?q=1',
      origin: 'o',
      actor: 'a',
      body: '',
    });
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).toBe(
      sign('k', {
        timestamp: '1',
        nonce: '0'.repeat(32),
        method: 'GET',
        path: '/p?q=1',
        origin: 'o',
        actor: 'a',
        body: '',
      }),
    );
  });
});

describe('conformance kit against the reference panel', () => {
  it('passes a conforming panel', async () => {
    const r = await run(panel());
    const failed = r.results.filter((x) => x.status === 'fail');
    expect(failed).toEqual([]);
    expect(r.conformant).toBe(true);
    expect(r.discovery?.implementation?.name).toBe('madp-reference-panel');
    expect(status(r, 'sync.option')).toBe('pass');
    expect(status(r, 'sync.userProfile')).toBe('pass');
    expect(status(r, 'admin.members')).toBe('pass');
  });

  it('never calls a route that writes', async () => {
    const methods: string[] = [];
    const inner = panel();
    await run((async (u: URL | string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return inner(u, init);
    }) as typeof fetch);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('skips personal-data routes without live approval', async () => {
    const paths: string[] = [];
    const inner = panel();
    const r = await run(
      (async (u: URL | string, init?: RequestInit) => {
        paths.push(new URL(String(u)).pathname);
        return inner(u, init);
      }) as typeof fetch,
      { allowPersonalData: false },
    );
    expect(r.conformant).toBe(true);
    expect(status(r, 'sync.changesMembers')).toBe('skip');
    expect(status(r, 'admin.members')).toBe('skip');
    expect(
      paths.some(
        (p) => p.includes('/changes/') || p.startsWith('/api/v1/admin/members') || p === '/api/v1/user',
      ),
    ).toBe(false);
    expect(status(r, 'sync.question')).toBe('pass');
  });

  it('skips undeclared capabilities instead of calling them', async () => {
    const r = await run(panel({ capabilities: [...CORE_CAPABILITIES] }));
    expect(r.conformant).toBe(true);
    expect(status(r, 'admin.tickets')).toBe('skip');
    expect(r.results.find((x) => x.id === 'admin.tickets')?.detail).toBe('not declared');
  });

  it.each([
    ['acceptReplay', 'auth.signed.replay'],
    ['acceptStale', 'auth.signed.stale'],
    ['noAuth', 'auth.required'],
    ['ignoreSince', 'sync.changesMembers'],
    ['stuckCursor', 'sync.changesMembers'],
    ['badQuestions', 'sync.question'],
  ] as const)('catches a panel with fault %s', async (fault, check) => {
    const r = await run(panel({ faults: { [fault]: true } }));
    expect(status(r, check)).toBe('fail');
    expect(r.conformant).toBe(false);
  });

  it('warns on a 404 without the error envelope', async () => {
    const r = await run(panel({ faults: { htmlNotFound: true } }));
    expect(status(r, 'errors.not_found')).toBe('warn');
  });

  it('fails when the brand is not served or the panel is unreachable', async () => {
    expect(status(await run(panel({ brands: ['www.other.example'] })), 'auth.signed.valid')).toBe('fail');
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await run(down);
    expect(status(r, 'discovery.answers')).toBe('fail');
  });
});

describe('OpenAPI document', () => {
  it('lists every operation once and matches the committed file', () => {
    const doc = panelContractOpenApi();
    const count = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
    expect(count).toBe(OPERATIONS.length);
    const committed = JSON.parse(
      readFileSync(new URL('../../../docs/panel-contract/openapi.v1.json', import.meta.url), 'utf8'),
    );
    // If this fails: pnpm --filter @madp/panel-contract build && pnpm --filter @madp/panel-contract openapi
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)));
    const routes = readFileSync(new URL('../../../docs/panel-contract/ROUTES.md', import.meta.url), 'utf8');
    expect(routes).toBe(panelContractRoutesMarkdown());
  });
});
