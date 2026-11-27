import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_RESOURCES,
  CORE_CAPABILITIES,
  createReferencePanel,
  matchOperation,
} from '@madp/panel-contract';
import { PANEL_ADMIN_ROUTES, PanelAdminClient, PanelApiConnector, endpointsFor } from './http-connector.js';
import { ConnectorError } from './types.js';

/**
 * MADP talks to panels only through the MADP Panel API Contract (packages/panel-contract). These tests keep the
 * connectors and every call site in apps/api inside it, and run the sync connector against the contract's reference
 * panel.
 */
const BASE = 'https://www.demo-panel.example';
const ORIGIN = 'www.demo-panel.example';
const TOKEN = 'demo-sync-token-0123456789abcdef';
const SECRET = 'demo-admin-secret-0123456789abcdef0123';

describe('connectors use the contract routes', () => {
  it('has one admin route helper per contract admin resource', () => {
    expect(Object.keys(PANEL_ADMIN_ROUTES).sort()).toEqual(Object.keys(ADMIN_RESOURCES).sort());
  });

  it('every sync endpoint is a contract read route', () => {
    const ep = endpointsFor('t2o');
    const paths = [
      ep.questions,
      ep.option('GENDER'),
      ep.questionnaires,
      ep.users,
      ep.answers.path('demo-m1'),
      ...Object.values(ep.changes ?? {}),
    ];
    for (const p of paths) expect(matchOperation('GET', p), p).not.toBeNull();
  });

  it('every panel call in apps/api is a method and route the contract defines', () => {
    // Finds `'METHOD', R.key(` and `'METHOD', R.key,` in the API sources, the way every controller calls the panel.
    const root = new URL('../../../apps/api/src', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(root);
    const calls: { file: string; method: string; key: string }[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/'(GET|POST|PUT|DELETE|PATCH)',\s*R\.(\w+)/g))
        calls.push({ file, method: m[1]!, key: m[2]! });
    }
    expect(calls.length).toBeGreaterThan(100);
    for (const c of calls) {
      const spec = ADMIN_RESOURCES[c.key];
      expect(spec, `${c.file}: R.${c.key} is not in the contract`).toBeDefined();
      expect(Object.keys(spec!.methods), `${c.file}: ${c.method} R.${c.key}`).toContain(c.method);
    }
  });
});

describe('sync connector against the reference panel', () => {
  const fetchImpl = createReferencePanel({ brands: [ORIGIN], syncToken: TOKEN, adminSecret: SECRET });
  const connector = (declared?: Parameters<typeof PanelApiConnector>[1]['declaredCapabilities']) =>
    new PanelApiConnector('t2o', {
      baseUrl: BASE,
      tenantHost: ORIGIN,
      bearerToken: TOKEN,
      fetchImpl,
      minIntervalMs: 0,
      ...(declared ? { declaredCapabilities: declared } : {}),
    });

  it('reads questions, options, questionnaires, members, answers and every feed', async () => {
    const c = connector();
    expect((await c.listQuestions()).map((q) => q.sourceQuestionId)).toEqual(['GENDER', 'COUNTRY']);
    expect((await c.listOptions('GENDER')).length).toBe(2);
    expect((await c.listQuestionnaires()).length).toBe(1);
    const members = await c.listRespondents(null, 10);
    expect(members.items.map((m) => m.sourceMemberId)).toEqual(['demo-m1', 'demo-m2', 'demo-m3']);
    const answers = await c.listAnswers(['demo-m1'], ['GENDER']);
    expect(answers[0]?.values).toEqual(['female']);
    const p1 = await c.memberChanges({ cursor: null, since: null, limit: 2 });
    expect(p1.items.length).toBe(2);
    expect(p1.more).toBe(true);
    const p2 = await c.memberChanges({ cursor: p1.cursor, since: null, limit: 2 });
    expect(p2.items.map((m) => m.sourceMemberId)).toEqual(['demo-m3']);
    expect(p2.more).toBe(false);
    expect((await c.answerChanges({ cursor: null, since: null, limit: 10 })).items.length).toBe(3);
    expect((await c.deletions({ cursor: null, since: null, limit: 10 })).items[0]?.kind).toBe('answers');
    expect((await c.rewardChanges({ cursor: null, since: null, limit: 10 })).items.length).toBe(1);
    expect((await c.responseChanges({ cursor: null, since: null, limit: 10 })).items.length).toBe(1);
  });

  it('discovers the panel’s capabilities with the sync token', async () => {
    const d = await connector().discover();
    expect(d.ok).toBe(true);
    expect(d.discovery?.brands.map((b) => b.origin)).toEqual([ORIGIN]);
    for (const c of CORE_CAPABILITIES) expect(d.capabilities).toContain(c);
  });

  it('does not call a feed the panel did not declare', async () => {
    let called = false;
    const spy = (async (u: URL | string, init?: RequestInit) => {
      if (String(u).includes('/changes/rewards')) called = true;
      return fetchImpl(u, init);
    }) as typeof fetch;
    const c = new PanelApiConnector('t2o', {
      baseUrl: BASE,
      tenantHost: ORIGIN,
      bearerToken: TOKEN,
      fetchImpl: spy,
      minIntervalMs: 0,
      declaredCapabilities: [...CORE_CAPABILITIES],
    });
    await expect(c.rewardChanges({ cursor: null, since: null, limit: 1 })).rejects.toMatchObject({
      kind: 'not_supported',
    } satisfies Partial<ConnectorError>);
    expect(called).toBe(false);
  });

  it('reports a panel without the discovery route as not discovered, not as broken', async () => {
    const legacy = (async (u: URL | string, init?: RequestInit) =>
      String(u).includes('/api/v1/contract')
        ? new Response(JSON.stringify({ status: 'error', message: 'Not found' }), { status: 404 })
        : fetchImpl(u, init)) as typeof fetch;
    const c = new PanelApiConnector('t2o', {
      baseUrl: BASE,
      tenantHost: ORIGIN,
      bearerToken: TOKEN,
      fetchImpl: legacy,
      minIntervalMs: 0,
    });
    const d = await c.discover();
    expect(d.ok).toBe(false);
    expect(d.httpStatus).toBe(404);
    expect(d.problems[0]).toMatch(/does not serve GET \/api\/v1\/contract/);
  });
});

describe('signed admin client against the reference panel', () => {
  it('discovers with a signed call and is refused for a brand the panel does not serve', async () => {
    const fetchImpl = createReferencePanel({ brands: [ORIGIN], syncToken: TOKEN, adminSecret: SECRET });
    const ok = new PanelAdminClient('t2o', { baseUrl: BASE, origin: ORIGIN, secret: SECRET, fetchImpl });
    const d = await ok.discover('actor');
    expect(d.ok).toBe(true);
    expect(await ok.call('actor', 'GET', PANEL_ADMIN_ROUTES.members, { limit: 1 })).toEqual([]);
    const other = new PanelAdminClient('t2o', {
      baseUrl: BASE,
      origin: 'www.other.example',
      secret: SECRET,
      fetchImpl,
    });
    await expect(other.call('actor', 'GET', PANEL_ADMIN_ROUTES.members)).rejects.toMatchObject({
      httpStatus: 403,
    });
  });
});
