import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import pg from 'pg';
import request from 'supertest';
import { startTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof startTestApp>>;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const PASSWORD = 'correct horse battery staple';

// Issue #94: there was no way to reset an admin's password.
describe('admin passwords: reset by a Super Admin, change your own', () => {
  let t: T;
  let sql: pg.Client;
  let superToken: string;
  let agent: { id: string; email: string; totp: OTPAuth.TOTP };
  let brandAdmin: string;

  beforeAll(async () => {
    t = await startTestApp();
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
    superToken = (await t.adminToken('super_admin')).token;
    brandAdmin = (await t.adminToken('brand_admin', 'mfr-admin@example.invalid', ['mfr'])).token;
    const a = await t.adminToken('support_agent', 'agent@example.invalid', ['mfr']);
    const { rows } = await sql.query(`select id from admin_user where email = 'agent@example.invalid'`);
    agent = { id: rows[0].id, email: 'agent@example.invalid', totp: a.totp! };
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
  });

  // A code is accepted once per 30 seconds, and these tests sign in several times in one window.
  const login = async (status: number, email: string, password: string, totp?: string) => {
    await sql.query('update admin_user set totp_last_step = null');
    return request(t.server)
      .post('/api/v1/auth/login')
      .send({ email, password, ...(totp ? { totp } : {}) })
      .expect(status);
  };

  it('resets a locked-out admin with a one-time password, ends their sessions and keeps two-factor', async () => {
    const before = await login(200, agent.email, PASSWORD, agent.totp.generate());
    // Locked out, as after five wrong passwords (sign-in is limited to 10 tries a minute, so set it directly).
    await sql.query(
      `update admin_user set failed_attempts = 5, locked_until = now() + interval '15 minutes' where id = $1`,
      [agent.id],
    );

    await request(t.server)
      .post(`/api/v1/admins/${agent.id}/reset-password`)
      .set(bearer(superToken))
      .send({ reason: 'x' })
      .expect(400);
    const reset = await request(t.server)
      .post(`/api/v1/admins/${agent.id}/reset-password`)
      .set(bearer(superToken))
      .send({ reason: 'Forgot their password' })
      .expect(200);
    expect(reset.body.oneTimePassword).toMatch(/^[\w-]{20}$/);

    // The old session is over, the old password no longer works, the lock is gone and two-factor still applies.
    await request(t.server).get('/api/v1/auth/me').set(bearer(before.body.token)).expect(401);
    await login(401, agent.email, PASSWORD, agent.totp.generate());
    await login(401, agent.email, reset.body.oneTimePassword);
    const after = await login(200, agent.email, reset.body.oneTimePassword, agent.totp.generate());
    expect(after.body.mfaSetupRequired).toBe(false);

    const audit = await request(t.server)
      .get('/api/v1/audit')
      .set(bearer(superToken))
      .query({ action: 'admins.password_reset' })
      .expect(200);
    const entry = audit.body.items.find((e: { targetId: string }) => e.targetId === agent.id);
    expect(entry).toMatchObject({
      reason: 'Forgot their password',
      metadata: { resetMfa: false, wasLocked: true },
    });
    expect(JSON.stringify(entry)).not.toContain(reset.body.oneTimePassword);
  });

  it('can clear two-factor for a lost phone, so the admin enrols again', async () => {
    const reset = await request(t.server)
      .post(`/api/v1/admins/${agent.id}/reset-password`)
      .set(bearer(superToken))
      .send({ resetMfa: true, reason: 'Lost their phone' })
      .expect(200);
    const r = await login(200, agent.email, reset.body.oneTimePassword);
    expect(r.body.mfaSetupRequired).toBe(true);
  });

  it('refuses a reset of yourself, of an unknown admin, and by someone without admins.manage', async () => {
    const me = await request(t.server).get('/api/v1/auth/me').set(bearer(superToken)).expect(200);
    await request(t.server)
      .post(`/api/v1/admins/${me.body.id}/reset-password`)
      .set(bearer(superToken))
      .send({ reason: 'Trying my own' })
      .expect(403);
    await request(t.server)
      .post('/api/v1/admins/00000000-0000-4000-8000-000000000000/reset-password')
      .set(bearer(superToken))
      .send({ reason: 'Nobody here' })
      .expect(404);
    await request(t.server)
      .post(`/api/v1/admins/${agent.id}/reset-password`)
      .set(bearer(brandAdmin))
      .send({ reason: 'Not my job' })
      .expect(403);
  });
});

describe('admin passwords: change your own', () => {
  let t: T;
  let sql: pg.Client;

  beforeAll(async () => {
    t = await startTestApp();
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
  });

  const login = async (status: number, email: string, password: string, totp?: string) => {
    await sql.query('update admin_user set totp_last_step = null');
    return request(t.server)
      .post('/api/v1/auth/login')
      .send({ email, password, ...(totp ? { totp } : {}) })
      .expect(status);
  };

  it('lets a signed-in admin change their own password with the current one', async () => {
    const email = 'changer@example.invalid';
    const { token, totp } = await t.adminToken('support_agent', email, ['t2o']);
    const other = await login(200, email, PASSWORD, totp!.generate());

    await request(t.server)
      .post('/api/v1/auth/password')
      .set(bearer(token))
      .send({ currentPassword: 'not the password', newPassword: 'a brand new long password' })
      .expect(403);
    await request(t.server)
      .post('/api/v1/auth/password')
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword: 'short' })
      .expect(400);
    await request(t.server)
      .post('/api/v1/auth/password')
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword: 'a brand new long password' })
      .expect(204);

    // This session stays, the other one ends, and only the new password signs in.
    await request(t.server).get('/api/v1/auth/me').set(bearer(token)).expect(200);
    await request(t.server).get('/api/v1/auth/me').set(bearer(other.body.token)).expect(401);
    await login(401, email, PASSWORD, totp!.generate());
    await login(200, email, 'a brand new long password', totp!.generate());
  });
});
