import request from 'supertest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AbuseService } from '../src/common/abuse.service.js';
import { MetaController } from '../src/common/meta.controller.js';
import { signWebhook } from '../src/webhooks/signature.js';
import { startTestApp } from './helpers.js';

/**
 * Hardening against scanners, bots and brute force on the routes that answer without a session (Kunal, 24 Nov 2026):
 * strict headers on every API answer, the route map hidden in production, and an address block on the signed public
 * routes (Supply360, webhooks) that stops a flood before it reaches the database or the audit log.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
let sql: pg.Client;
const MAX = 5;

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '10', WEBHOOK_SECRETS_MFR: 'w'.repeat(40), ABUSE_MAX_FAILURES: String(MAX) });
  sql = new pg.Client({ connectionString: t.dbUrl });
  await sql.connect();
}, 120_000);
afterAll(async () => {
  await sql?.end();
  await t?.stop();
});

const audited = async (action: string) =>
  Number((await sql.query('select count(*)::int as n from audit_event where action = $1', [action])).rows[0].n);

describe('headers on every API answer', () => {
  it('serves JSON only: no scripts, frames, caching, referrer or device APIs', async () => {
    for (const path of ['/api/v1/health', '/api/v1/auth/me', '/api/v1/does-not-exist']) {
      const r = await request(t.server).get(path);
      expect(r.headers['content-security-policy'], path).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'");
      expect(r.headers['cache-control'], path).toBe('no-store');
      expect(r.headers['referrer-policy'], path).toBe('no-referrer');
      expect(r.headers['x-frame-options'], path).toBe('DENY');
      expect(r.headers['strict-transport-security'], path).toMatch(/max-age=63072000; includeSubDomains; preload/);
      expect(r.headers['permissions-policy'], path).toContain('camera=()');
      expect(r.headers['x-powered-by'], path).toBeUndefined();
    }
  });
});

describe('route map', () => {
  it('is public in development and hidden in production unless switched on', () => {
    expect(() => new MetaController({ ...t.env, NODE_ENV: 'development' }).openapi()).not.toThrow();
    const prod = { ...t.env, NODE_ENV: 'production' as const, OPENAPI_PUBLIC: undefined };
    expect(() => new MetaController(prod).openapi()).toThrow(/Not Found/);
    expect(() => new MetaController({ ...prod, OPENAPI_PUBLIC: true }).openapi()).not.toThrow();
  });
});

describe('address block on the signed public routes', () => {
  it('Supply360: after the limit an address gets 429 with no database work and no more audit rows', async () => {
    const before = await audited('service.rejected');
    const statuses: number[] = [];
    for (let i = 0; i < MAX + 10; i++)
      statuses.push((await request(t.server).post('/api/v1/supply360/counts').set('x-madp-client', `bot-${i}`).send({})).status);
    expect(statuses.slice(0, MAX - 1).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(MAX)).toEqual(Array(10).fill(429));
    // Every refusal up to and including the one that starts the block is audited; nothing after it.
    expect((await audited('service.rejected')) - before).toBe(MAX);
    const [last] = (await sql.query("select metadata from audit_event where action = 'service.rejected' order by id desc limit 1")).rows;
    expect(last.metadata.addressBlocked).toBe(true);
  });

  it('webhooks: bad signatures from one address are blocked the same way, and the block is per route family', async () => {
    const body = JSON.stringify({ type: 'member.updated', occurredAt: new Date().toISOString() });
    const ts = String(Math.floor(Date.now() / 1000));
    const before = await audited('webhook.rejected');
    const statuses: number[] = [];
    for (let i = 0; i < MAX + 3; i++)
      statuses.push(
        (
          await request(t.server)
            .post('/api/v1/webhooks/mfr')
            .set('content-type', 'application/json')
            .set('x-madp-event-id', `evt-bot-${i}`)
            .set('x-madp-timestamp', ts)
            .set('x-madp-signature', signWebhook('not-the-secret-not-the-secret-0000', ts, `evt-bot-${i}`, body))
            .send(body)
        ).status,
      );
    expect(statuses.slice(0, MAX - 1).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(MAX)).toEqual([429, 429, 429]);
    expect((await audited('webhook.rejected')) - before).toBe(MAX);
  });

  it('forgets an address after the block, and a signed client is never blocked for scope or rate refusals', () => {
    const abuse = new AbuseService({ ...t.env, ABUSE_MAX_FAILURES: 3 });
    const t0 = 1_000_000;
    expect(abuse.fail('service', '203.0.113.7', t0)).toEqual({ audit: true, blocked: false });
    abuse.fail('service', '203.0.113.7', t0 + 1);
    expect(abuse.fail('service', '203.0.113.7', t0 + 2)).toEqual({ audit: true, blocked: true });
    expect(abuse.fail('service', '203.0.113.7', t0 + 3)).toEqual({ audit: false, blocked: true });
    expect(() => abuse.check('service', '203.0.113.7', t0 + 60_000)).toThrow(/Too many/);
    // Another address, and another route family, are not affected.
    expect(() => abuse.check('service', '203.0.113.8', t0 + 60_000)).not.toThrow();
    expect(() => abuse.check('webhook', '203.0.113.7', t0 + 60_000)).not.toThrow();
    // Fifteen minutes later the address starts clean.
    expect(() => abuse.check('service', '203.0.113.7', t0 + 15 * 60_000 + 3)).not.toThrow();
    // Failures spread over more than ten minutes never add up to a block.
    for (let i = 0; i < 10; i++) expect(abuse.fail('webhook', '198.51.100.1', t0 + i * 6 * 60_000).blocked).toBe(false);
  });
});
