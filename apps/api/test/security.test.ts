import 'reflect-metadata';
import request from 'supertest';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module.js';
import { MFA_SETUP_KEY, PERMISSIONS_KEY, PUBLIC_KEY } from '../src/auth/decorators.js';
import { startTestApp } from './helpers.js';

/**
 * Security checks over every route the API exposes (Milestone 6): each route is either public by design or needs a
 * session and a permission; nothing answers without credentials; tampered tokens fail; security headers, CORS and
 * login throttling hold.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;

/** Public by design. Each of these checks its own credentials (a signed service request, a webhook signature). */
const PUBLIC_ALLOWED = new Set([
  'GET /health',
  'GET /openapi.json',
  'POST /auth/login',
]);
const PUBLIC_PREFIXES_WITH_OWN_AUTH = ['/supply360/', '/webhooks/'];
/** Any signed-in admin may use these, with no extra permission (their own session). */
const SESSION_ONLY = new Set(['POST /auth/logout', 'GET /auth/me', 'POST /auth/mfa/setup', 'POST /auth/mfa/confirm']);
/** Signed-in only, with the permission checked in the handler per brand (brands.controller.ts). */
const CHECKED_IN_HANDLER = new Set(['GET /brands', 'PUT /brands/:panel/settings']);

interface Route {
  method: string;
  path: string;
  isPublic: boolean;
  permissions: string[];
  mfaSetup: boolean;
}

function routes(): Route[] {
  const controllers = (AppModule.forRoot({} as never).controllers ?? []) as (new (...a: never[]) => object)[];
  const out: Route[] = [];
  for (const c of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, c) ?? '');
    const classPublic = Reflect.getMetadata(PUBLIC_KEY, c) === true;
    const classPerms = (Reflect.getMetadata(PERMISSIONS_KEY, c) ?? []) as string[];
    for (const name of Object.getOwnPropertyNames(c.prototype)) {
      const fn = (c.prototype as Record<string, unknown>)[name];
      if (typeof fn !== 'function' || name === 'constructor') continue;
      const sub = Reflect.getMetadata(PATH_METADATA, fn);
      if (sub === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn) as number]!;
      const path = `/${[base, String(sub)].filter((x) => x && x !== '/').join('/')}`.replace(/\/+/g, '/');
      out.push({
        method,
        path,
        isPublic: classPublic || Reflect.getMetadata(PUBLIC_KEY, fn) === true,
        permissions: [...classPerms, ...((Reflect.getMetadata(PERMISSIONS_KEY, fn) ?? []) as string[])],
        mfaSetup: Reflect.getMetadata(MFA_SETUP_KEY, fn) === true,
      });
    }
  }
  return out;
}
const fill = (p: string) => p.replace(/:([A-Za-z]+)/g, (_, k: string) => (/id$/i.test(k) ? '00000000-0000-4000-8000-000000000000' : k === 'panel' ? 'mfr' : 'x'));

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '10', WEBHOOK_SECRETS_MFR: 'w'.repeat(40) });
});
afterAll(async () => t?.stop());

describe('route inventory', () => {
  const all = routes();

  it('finds the routes', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('every route is public by design, session-only by design, or needs a permission', () => {
    const problems: string[] = [];
    for (const r of all) {
      const key = `${r.method} ${r.path}`;
      if (r.isPublic) {
        if (!PUBLIC_ALLOWED.has(key) && !PUBLIC_PREFIXES_WITH_OWN_AUTH.some((p) => r.path.startsWith(p)))
          problems.push(`${key} is public but not on the allow list`);
      } else if (!r.permissions.length && !SESSION_ONLY.has(key) && !CHECKED_IN_HANDLER.has(key)) problems.push(`${key} has no @RequirePermissions`);
      if (r.mfaSetup && !SESSION_ONLY.has(key)) problems.push(`${key} is reachable before MFA enrolment`);
    }
    expect(problems).toEqual([]);
  });

  it('documents the MADP screens and the Supply360 contract in OpenAPI', async () => {
    const doc = (await request(t.server).get('/api/v1/openapi.json').expect(200)).body as { paths: Record<string, Record<string, unknown>> };
    const covered = ['/audience/', '/consent/', '/privacy/', '/profiles/', '/verification/', '/reports', '/insights', '/supply360/'];
    const missing = all
      .filter((r) => covered.some((c) => r.path.startsWith(c)))
      .filter((r) => !doc.paths[r.path.replace(/:([A-Za-z]+)/g, '{$1}')]?.[r.method.toLowerCase()])
      .map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  });

  it('nothing answers without credentials', async () => {
    const leaks: string[] = [];
    for (const r of all) {
      if (PUBLIC_ALLOWED.has(`${r.method} ${r.path}`)) continue;
      const m = r.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      const res = await request(t.server)[m](`/api/v1${fill(r.path)}`).send({});
      if (![401, 403].includes(res.status)) leaks.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);
});

describe('tokens, headers, CORS and throttling', () => {
  it('rejects tampered, foreign and expired tokens', async () => {
    const { token } = await t.adminToken('super_admin');
    await request(t.server).get('/api/v1/auth/me').set('authorization', `Bearer ${token}`).expect(200);
    const [h, p, s] = token.split('.');
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: '00000000-0000-4000-8000-000000000000' })).toString('base64url')}.${s}`;
    await request(t.server).get('/api/v1/auth/me').set('authorization', `Bearer ${forged}`).expect(401);
    const sign = (c: Record<string, unknown>, secret: string) =>
      new SignJWT(c).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(secret));
    const foreign = await sign(claims, 'not-the-secret-not-the-secret-not-the-secret');
    await request(t.server).get('/api/v1/auth/me').set('authorization', `Bearer ${foreign}`).expect(401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    await request(t.server).get('/api/v1/auth/me').set('authorization', `Bearer ${none}`).expect(401);
    const expired = await sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, t.env.AUTH_JWT_SECRET);
    await request(t.server).get('/api/v1/auth/me').set('authorization', `Bearer ${expired}`).expect(401);
  });

  it('sends security headers and hides the framework', async () => {
    const r = await request(t.server).get('/api/v1/health').expect(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(r.headers['content-security-policy']).toBeDefined();
    expect(r.headers['x-frame-options']).toBeDefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-request-id']).toBeDefined();
  });

  it('allows the admin origin only', async () => {
    const ok = await request(t.server).options('/api/v1/auth/me').set('origin', t.env.ADMIN_ORIGIN).set('access-control-request-method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(t.env.ADMIN_ORIGIN);
    const evil = await request(t.server).options('/api/v1/auth/me').set('origin', 'https://evil.example').set('access-control-request-method', 'GET');
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  it('rejects malformed input before it reaches the database', async () => {
    const { token } = await t.adminToken('data_steward', 'steward.sec@example.invalid');
    const auth = { authorization: `Bearer ${token}` };
    await request(t.server).get("/api/v1/verification/checks?panel=t2o&check=x'%20or%201=1--").set(auth).expect(400);
    await request(t.server).post('/api/v1/audience/geo').set(auth).send({ country: "x' or 1=1" }).expect(400);
    await request(t.server).get('/api/v1/reports/sync_health?from=2026-01-01%27').set(auth).expect(400);
    const big = await request(t.server).post('/api/v1/audience/counts').set(auth).set('content-type', 'application/json').send(`{"panels":["${'a'.repeat(200_000)}"]}`);
    expect(big.status).toBe(413);
  });
  it('throttles repeated sign-in attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++)
      statuses.push((await request(t.server).post('/api/v1/auth/login').send({ email: 'nobody@example.invalid', password: 'wrong' })).status);
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
  });
});
