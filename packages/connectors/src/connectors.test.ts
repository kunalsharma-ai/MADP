import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_CODES } from '@madp/contracts';
import { AUDITED_CAPABILITIES, DemoConnector, PanelApiConnector, ConnectorError } from './index.js';

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
      if (req.url === '/api/v1/user' && req.method === 'POST')
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
  it('T2O uses GET /user/:id/profile; MFR and MHO use POST /user/:id/profile-data with the question list', async () => {
    seen.length = 0;
    await make('t2o').listAnswers(['u1'], ['gender']);
    await make('mfr').listAnswers(['u1'], ['gender']);
    await make('mho').listAnswers(['u1'], ['gender']);
    const calls = seen.filter((s) => s.url.startsWith('/api/v1/user/u1'));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/user/u1/profile',
      'POST /api/v1/user/u1/profile-data',
      'POST /api/v1/user/u1/profile-data',
    ]);
    expect(JSON.parse(calls[1]!.body)).toEqual({ questions: ['gender'] });
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
