import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_CODES } from '@madp/contracts';
import {
  AUDITED_CAPABILITIES,
  DemoConnector,
  PanelApiConnector,
  ConnectorError,
  parseRetryAfter,
} from './index.js';

/**
 * Contract tests against a local stub that reproduces the response envelope and routes read in the
 * source repositories ({status, message, data}; errors are HTTP 404 with status "error"). These prove the
 * connector speaks the audited contract. Live contract tests against each panel run only after access is
 * approved (docs/THREE_PANEL_ACCEPTANCE_MATRIX.md).
 */
let server: http.Server;
let base = '';
const seen: { method: string; url: string; host: string; auth: string; body: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        host: req.headers.host!,
        auth: String(req.headers.authorization),
        body,
      });
      const ok = (data: unknown) => res.end(JSON.stringify({ status: 'success', message: '', data }));
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== 'Bearer good') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ status: 'error', message: 'Unauthorized [No Token Found]' }));
      }
      if (req.url === '/api/v1/question')
        return ok([
          {
            name: 'gender',
            label: 'Gender',
            type: 'select',
            category: ['b2c'],
            maxSelections: '0',
            count: 3,
          },
        ]);
      if (req.url === '/api/v1/option/gender')
        return ok([{ question: 'gender', label: 'Female', value: 'female', parentValue: [] }]);
      if (req.url === '/api/v1/profile')
        return ok([{ name: 'basic profile', slug: 'basic', category: 'b2c', pages: [['Basic', 'gender']] }]);
      if (req.url === '/api/v1/user' && req.method === 'GET')
        return ok([
          {
            _id: 'u1',
            mail: 'a@example.invalid',
            category: 'b2c',
            address: [{ country: 'IN', city: 'mumbai' }],
            isVerified: { email: 'verified' },
            createdAt: '2026-01-01T00:00:00Z',
          },
          { _id: 'u2', mail: 'b@example.invalid', category: 'b2b' },
        ]);
      if (req.url?.startsWith('/api/v1/user/u1/'))
        return ok({ _id: 'u1', mail: 'a@example.invalid', gender: 'female', hobbies: ['reading', 'travel'] });
      // Changes feeds (turn2opinion#20): two member pages, then one answer page and one deletion page.
      const u = new URL(req.url!, 'http://stub');
      if (u.pathname === '/api/v1/changes/members') {
        if (req.headers.host?.startsWith('localhost')) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ status: 'error', message: 'Fallback route' }));
        }
        return u.searchParams.get('cursor') === 'm1'
          ? ok({
              items: [
                { _id: 'u2', category: 'minor', isDeleted: true, parent: { consentStatus: 'approved' } },
              ],
              cursor: 'm2',
              more: false,
            })
          : ok({
              items: [{ _id: 'u1', category: 'b2c', mail: 'a@example.invalid', isActive: true }],
              cursor: 'm1',
              more: true,
            });
      }
      if (u.pathname === '/api/v1/changes/answers')
        return ok({
          items: [
            {
              _id: 'a1',
              user: 'u1',
              question: 'hobbies',
              answer: ['reading'],
              updatedAt: '2026-11-23T10:00:00Z',
            },
          ],
          cursor: 'a1c',
          more: false,
        });
      if (u.pathname === '/api/v1/changes/deletions')
        return ok({
          items: [
            { _id: 't1', kind: 'member', user: 'u9', at: '2026-11-23T11:00:00Z' },
            { _id: 't2', kind: 'something-new', user: 'u8' },
          ],
          cursor: null,
          more: false,
        });
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'error', message: `Fallback route: ${req.url} is not available` }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const make = (panel: 't2o' | 'mfr' | 'mho', token = 'good') =>
  new PanelApiConnector(panel, {
    baseUrl: base,
    tenantHost: new URL(base).host,
    bearerToken: token,
    minIntervalMs: 0,
  });

describe.each(PANEL_CODES)('PanelApiConnector [%s]', (panel) => {
  it('reads questions, options and questionnaires with the audited shapes', async () => {
    const c = make(panel);
    const [q] = await c.listQuestions();
    expect(q).toMatchObject({
      panel,
      sourceQuestionId: 'gender',
      type: 'select',
      maxSelections: 0,
      categories: ['b2c'],
    });
    expect(await c.listOptions('gender')).toEqual([
      {
        panel,
        sourceQuestionId: 'gender',
        value: 'female',
        label: 'Female',
        parentValues: [],
        isExclusive: false,
      },
    ]);
    const [p] = await c.listQuestionnaires();
    expect(p).toMatchObject({ slug: 'basic', sourceCategory: 'b2c', pages: [['Basic', 'gender']] });
  });

  it('pages respondents and keeps source provenance', async () => {
    const c = make(panel);
    const first = await c.listRespondents(null, 1);
    expect(first.items[0]).toMatchObject({
      panel,
      sourceMemberId: 'u1',
      country: 'in',
      emailVerification: 'verified',
    });
    expect(first.nextCursor).toBe('1');
    const second = await c.listRespondents(first.nextCursor, 1);
    expect(second.items[0]?.sourceMemberId).toBe('u2');
    expect(second.nextCursor).toBeNull();
  });

  it('reads the changes feeds with the cursor, and maps soft-deleted members and tombstones', async () => {
    const c = make(panel);
    const first = await c.memberChanges({ cursor: null, since: '2026-11-01T00:00:00.000Z', limit: 1 });
    expect(seen.at(-1)!.url).toBe('/api/v1/changes/members?limit=1&since=2026-11-01T00%3A00%3A00.000Z');
    expect(first).toMatchObject({
      cursor: 'm1',
      more: true,
      items: [{ sourceMemberId: 'u1', isActive: true }],
    });
    const second = await c.memberChanges({
      cursor: first.cursor,
      since: '2026-11-01T00:00:00.000Z',
      limit: 1,
    });
    expect(seen.at(-1)!.url).toBe('/api/v1/changes/members?limit=1&cursor=m1');
    expect(second.items[0]).toMatchObject({ sourceMemberId: 'u2', isActive: false, isDeleted: true });
    expect(second.items[0]!.consents[0]).toMatchObject({ purpose: 'guardian_consent', status: 'granted' });
    expect(await c.answerChanges({ cursor: 'x', limit: 1000 })).toEqual({
      items: [
        {
          panel,
          sourceMemberId: 'u1',
          sourceQuestionId: 'hobbies',
          values: ['reading'],
          sourceUpdatedAt: '2026-11-23T10:00:00.000Z',
        },
      ],
      cursor: 'a1c',
      more: false,
    });
    // An empty page keeps the reader's cursor; an unknown tombstone kind is ignored.
    expect(await c.deletions({ cursor: 'keep', limit: 10 })).toEqual({
      items: [{ panel, sourceMemberId: 'u9', kind: 'member', at: '2026-11-23T11:00:00.000Z' }],
      cursor: 'keep',
      more: false,
    });
  });

  it('reports a backend without the changes feed as not supported', async () => {
    const port = new URL(base).port;
    const c = new PanelApiConnector(panel, {
      baseUrl: `http://localhost:${port}`,
      tenantHost: `localhost:${port}`,
      bearerToken: 'good',
      minIntervalMs: 0,
    });
    await expect(c.memberChanges({ cursor: null, limit: 10 })).rejects.toMatchObject({
      kind: 'not_supported',
      httpStatus: 404,
    });
  });

  it('returns only answers to the requested questions, as arrays', async () => {
    const answers = await make(panel).listAnswers(['u1'], ['hobbies', 'gender']);
    expect(answers).toEqual([
      { panel, sourceMemberId: 'u1', sourceQuestionId: 'gender', values: ['female'], sourceUpdatedAt: null },
      {
        panel,
        sourceMemberId: 'u1',
        sourceQuestionId: 'hobbies',
        values: ['reading', 'travel'],
        sourceUpdatedAt: null,
      },
    ]);
  });

  it('surfaces refused access as not_authorised', async () => {
    await expect(make(panel, 'bad').listQuestions()).rejects.toMatchObject({ kind: 'not_authorised' });
  });

  it('declares an audited capability list', () => {
    expect(AUDITED_CAPABILITIES[panel].length).toBeGreaterThan(10);
  });
});

describe('panel-specific answer endpoints', () => {
  it('all three panels read answers from the T2O backend profile route they run in production', async () => {
    seen.length = 0;
    await make('t2o').listAnswers(['u1'], ['gender']);
    await make('mfr').listAnswers(['u1'], ['gender']);
    await make('mho').listAnswers(['u1'], ['gender']);
    const calls = seen.filter((s) => s.url.startsWith('/api/v1/user/u1'));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/user/u1/profile',
      'GET /api/v1/user/u1/profile',
      'GET /api/v1/user/u1/profile',
    ]);
  });

  it('refuses a base URL whose host is not the tenant host', () => {
    expect(
      () =>
        new PanelApiConnector('t2o', {
          baseUrl: 'https://other.example',
          tenantHost: 'www.turn2opinion.com',
          bearerToken: 'x',
        }),
    ).toThrow(ConnectorError);
  });
});

describe.each(PANEL_CODES)('DemoConnector [%s]', (panel) => {
  it('serves sampled questionnaires and synthetic respondents only', async () => {
    const c = new DemoConnector(panel, 300);
    expect((await c.listQuestionnaires()).length).toBeGreaterThan(0);
    const qs = await c.listQuestions();
    expect(qs.length).toBeGreaterThan(5);
    const page = await c.listRespondents(null, 50);
    expect(page.items.every((r) => r.panel === panel && r.sourceMemberId.startsWith('demo-'))).toBe(true);
    const answers = await c.listAnswers(
      page.items.map((r) => r.sourceMemberId),
      qs.map((q) => q.sourceQuestionId),
    );
    expect(answers.every((a) => a.panel === panel)).toBe(true);
  });
});

describe('PanelApiConnector retry and backoff', () => {
  const envelope = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const build = (responses: (() => Response | Promise<Response>)[], maxRetries = 3) => {
    const sleeps: number[] = [];
    let calls = 0;
    const c = new PanelApiConnector('t2o', {
      baseUrl: 'https://panel.example.invalid',
      tenantHost: 'panel.example.invalid',
      bearerToken: 'good',
      minIntervalMs: 0,
      maxRetries,
      retryBaseMs: 100,
      sleep: async (ms) => void sleeps.push(ms),
      fetchImpl: (async () => responses[Math.min(calls++, responses.length - 1)]!()) as typeof fetch,
    });
    return { c, sleeps, calls: () => calls };
  };

  it('retries 429 and 5xx, honouring Retry-After, then succeeds', async () => {
    const { c, sleeps, calls } = build([
      () => envelope(429, { status: 'error', message: 'slow down' }, { 'retry-after': '2' }),
      () => envelope(503, { status: 'error', message: 'unavailable' }),
      () => envelope(200, { status: 'success', data: [] }),
    ]);
    expect(await c.listQuestions()).toEqual([]);
    expect(calls()).toBe(3);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBeLessThanOrEqual(200);
  });

  it('retries network errors and gives up after maxRetries with the last error', async () => {
    const { c, calls } = build([() => Promise.reject(new TypeError('fetch failed'))], 2);
    await expect(c.listQuestions()).rejects.toMatchObject({ kind: 'source_error', message: /fetch failed/ });
    expect(calls()).toBe(3);
  });

  it('never retries refused access or a panel 404 error envelope', async () => {
    const refused = build([() => envelope(403, { status: 'error', message: 'Forbidden' })]);
    await expect(refused.c.listQuestions()).rejects.toMatchObject({ kind: 'not_authorised' });
    expect(refused.calls()).toBe(1);
    const missing = build([() => envelope(404, { status: 'error', message: 'Fallback route' })]);
    await expect(missing.c.listQuestions()).rejects.toMatchObject({ kind: 'source_error' });
    expect(missing.calls()).toBe(1);
  });

  it('parses Retry-After seconds and dates, capped at 60 s', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('600')).toBe(60_000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
