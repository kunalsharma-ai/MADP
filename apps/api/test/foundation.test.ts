import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { DEFAULT_ROLES } from '../src/auth/permissions.js';
import { startTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof startTestApp>>;
const bearer = (t: string, brand?: string) => ({
  authorization: `Bearer ${t}`,
  ...(brand ? { 'x-madp-brand': brand } : {}),
});

describe('super admin foundation: roles per brand, sessions, hash-chained audit, brands', () => {
  let t: T;
  let sql: pg.Client;
  let superToken: string;
  let mfrAdmin: string;

  beforeAll(async () => {
    t = await startTestApp();
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
    superToken = (await t.adminToken('super_admin')).token;
    mfrAdmin = (await t.adminToken('brand_admin', 'mfr-admin@example.invalid', ['mfr'])).token;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
  });

  it('seeds the built-in roles exactly as DEFAULT_ROLES', async () => {
    const res = await request(t.server).get('/api/v1/roles').set(bearer(superToken)).expect(200);
    const byKey = new Map<string, { permissions: string[]; system: boolean }>(
      res.body.map((r: { key: string; permissions: string[]; system: boolean }) => [r.key, r]),
    );
    for (const [key, def] of Object.entries(DEFAULT_ROLES)) {
      expect(byKey.get(key)?.system).toBe(true);
      expect([...(byKey.get(key)?.permissions ?? [])].sort()).toEqual([...def.permissions].sort());
    }
    expect(DEFAULT_ROLES.brand_admin.permissions).not.toContain('switches.flip');
    expect(
      DEFAULT_ROLES.read_only_analyst.permissions.some((p) =>
        /\.(edit|adjust|manage|send|publish|flip)$/.test(p),
      ),
    ).toBe(false);
  });

  it('keeps a Brand Admin for MFR inside MFR', async () => {
    const me = await request(t.server).get('/api/v1/auth/me').set(bearer(mfrAdmin)).expect(200);
    expect(me.body.brands).toEqual(['mfr']);
    expect(me.body.permissions).toEqual([]);
    const brands = await request(t.server).get('/api/v1/brands').set(bearer(mfrAdmin)).expect(200);
    expect(brands.body.brands.map((b: { panel: string }) => b.panel)).toEqual(['mfr']);
    expect(brands.body.allowAll).toBe(false);
    // Cross-brand screens need the permission on every brand.
    await request(t.server).get('/api/v1/panellists').set(bearer(mfrAdmin)).expect(403);
    // Brand-scoped routes: refused on another brand and on "all", allowed on MFR.
    await request(t.server).get('/api/v1/audit').set(bearer(mfrAdmin, 't2o')).expect(403);
    await request(t.server).get('/api/v1/audit').set(bearer(mfrAdmin)).expect(403);
    await request(t.server).get('/api/v1/audit').set(bearer(mfrAdmin, 'nope')).expect(400);
    const own = await request(t.server).get('/api/v1/audit').set(bearer(mfrAdmin, 'mfr')).expect(200);
    expect(own.body.items.every((e: { panel: string }) => e.panel === 'mfr')).toBe(true);
    // No admin accounts, roles or switch-level settings.
    await request(t.server).get('/api/v1/admins').set(bearer(mfrAdmin)).expect(403);
    await request(t.server).put('/api/v1/roles/brand_admin').set(bearer(mfrAdmin)).send({}).expect(403);
    const denied = await request(t.server)
      .get('/api/v1/audit')
      .set(bearer(superToken))
      .query({ action: 'authz.denied' })
      .expect(200);
    expect(denied.body.items.some((e: { panel: string }) => e.panel === 't2o')).toBe(true);
  });

  it('creates admins without privilege escalation and forces two-factor', async () => {
    const created = await request(t.server)
      .post('/api/v1/admins')
      .set(bearer(superToken))
      .send({
        email: 'support-mho@example.invalid',
        displayName: 'Support MHO',
        grants: [{ role: 'support_agent', brands: ['mho'] }],
      })
      .expect(201);
    expect(created.body.oneTimePassword).toMatch(/^[\w-]{20}$/);
    const login = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: 'support-mho@example.invalid', password: created.body.oneTimePassword })
      .expect(200);
    expect(login.body.mfaSetupRequired).toBe(true);
    await request(t.server).get('/api/v1/brands').set(bearer(login.body.token)).expect(403);

    // A custom role made without code, then granted.
    await request(t.server)
      .post('/api/v1/roles')
      .set(bearer(superToken))
      .send({
        key: 'mfr_auditor',
        name: 'MFR auditor',
        description: 'Reads the audit log',
        permissions: ['audit.read'],
      })
      .expect(201);
    await request(t.server)
      .put(`/api/v1/admins/${created.body.id}`)
      .set(bearer(superToken))
      .send({ grants: [{ role: 'mfr_auditor', brands: ['mfr'] }], reason: 'Moved to audit work' })
      .expect(200);
    await request(t.server)
      .put('/api/v1/roles/super_admin')
      .set(bearer(superToken))
      .send({ name: 'Renamed', permissions: [], reason: 'try it out' })
      .expect(403);

    // A Super Admin cannot remove the last Super Admin (themselves) either.
    const me = await request(t.server).get('/api/v1/auth/me').set(bearer(superToken)).expect(200);
    await request(t.server)
      .put(`/api/v1/admins/${me.body.id}`)
      .set(bearer(superToken))
      .send({ isActive: false, reason: 'leaving the company' })
      .expect(403);

    const audit = await request(t.server)
      .get('/api/v1/audit')
      .set(bearer(superToken))
      .query({ action: 'admins.' })
      .expect(200);
    const update = audit.body.items.find((e: { action: string }) => e.action === 'admins.update');
    expect(update.before.grants).toEqual([{ role: 'support_agent', brands: ['mho'] }]);
    expect(update.after.grants).toEqual([{ role: 'mfr_auditor', brands: ['mfr'] }]);
    expect(update.reason).toBe('Moved to audit work');
    expect(update.actorRole).toBe('super_admin');
    expect(update.requestId).toBeTruthy();
    const createdEntry = audit.body.items.find((e: { action: string }) => e.action === 'admins.create');
    expect(createdEntry.after.email).toBe('s***@example.invalid');
  });

  it('ends a session after 30 idle minutes and on sign-out', async () => {
    const { token } = await t.adminToken('read_only_analyst', 'analyst-idle@example.invalid');
    await request(t.server).get('/api/v1/auth/me').set(bearer(token)).expect(200);
    await sql.query(
      `update admin_session set last_seen_at = now() - interval '31 minutes'
         where admin_id = (select id from admin_user where email = 'analyst-idle@example.invalid')`,
    );
    await request(t.server).get('/api/v1/auth/me').set(bearer(token)).expect(401);

    const second = await t.adminToken('read_only_analyst', 'analyst-out@example.invalid');
    await request(t.server).post('/api/v1/auth/logout').set(bearer(second.token)).expect(204);
    await request(t.server).get('/api/v1/auth/me').set(bearer(second.token)).expect(401);
  });

  it("seeds each brand's support address, and only Super Admin can change it, with a reason", async () => {
    const before = await request(t.server).get('/api/v1/brands').set(bearer(superToken)).expect(200);
    expect(
      before.body.brands.map((b: { panel: string; supportEmail: string }) => [b.panel, b.supportEmail]),
    ).toEqual([
      ['t2o', 'support@turn2opinion.com'],
      ['mfr', 'support@myfrequentrewards.com'],
      ['mho', 'support@myhealthopinions.com'],
    ]);
    await request(t.server)
      .put('/api/v1/brands/mfr/settings')
      .set(bearer(mfrAdmin))
      .send({ supportEmail: 'help@myfrequentrewards.com', reason: 'not mine to change' })
      .expect(403);
    await request(t.server)
      .put('/api/v1/brands/mfr/settings')
      .set(bearer(superToken))
      .send({ supportEmail: 'not-an-address', reason: 'typo check' })
      .expect(400);
    const r = await request(t.server)
      .put('/api/v1/brands/mfr/settings')
      .set(bearer(superToken))
      .send({ supportEmail: 'Help@MyFrequentRewards.com', reason: 'Testing the sender change' })
      .expect(200);
    expect(r.body.supportEmail).toBe('help@myfrequentrewards.com');
    await request(t.server)
      .put('/api/v1/brands/mfr/settings')
      .set(bearer(superToken))
      .send({ supportEmail: 'support@myfrequentrewards.com', reason: 'Back to the real one' })
      .expect(200);
  });

  it('keeps money settings for Super Admin and audits every change', async () => {
    await request(t.server)
      .put('/api/v1/brands/mfr/settings')
      .set(bearer(mfrAdmin))
      .send({ fourEyesPoints: 10, reason: 'lower the limit' })
      .expect(403);
    const res = await request(t.server)
      .put('/api/v1/brands/mfr/settings')
      .set(bearer(superToken))
      .send({ fourEyesPoints: 60000, reason: 'Kunal asked for 60 USD' })
      .expect(200);
    expect(res.body.fourEyesPoints).toBe(60000);
    await request(t.server)
      .put('/api/v1/brands/mfr/settings')
      .set(bearer(superToken))
      .send({ fourEyesPoints: 1 })
      .expect(400);
    const audit = await request(t.server)
      .get('/api/v1/audit')
      .set(bearer(superToken, 'mfr'))
      .query({ action: 'brands.settings.update' })
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      panel: 'mfr',
      before: { fourEyesPoints: 50000 },
      after: { fourEyesPoints: 60000 },
    });
    const brands = await request(t.server).get('/api/v1/brands').set(bearer(superToken)).expect(200);
    expect(
      brands.body.brands.map((b: { panel: string; pointsPerCurrencyUnit: number }) => [
        b.panel,
        b.pointsPerCurrencyUnit,
      ]),
    ).toEqual([
      ['t2o', 1000],
      ['mfr', 1000],
      ['mho', 1000],
    ]);
  });

  it('exports the audit log as CSV and logs the export', async () => {
    const res = await request(t.server)
      .get('/api/v1/audit/export')
      .set(bearer(superToken, 'mfr'))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toMatch(/^id,at,actorId/);
    expect(lines.length).toBeGreaterThan(1);
    const audit = await request(t.server)
      .get('/api/v1/audit')
      .set(bearer(superToken))
      .query({ action: 'audit.export' })
      .expect(200);
    expect(audit.body.items[0].panel).toBe('mfr');
  });

  it('cannot edit or delete audit entries, and the chain check finds any change', async () => {
    await expect(
      sql.query(`update audit_event set reason = 'x' where id = (select min(id) from audit_event)`),
    ).rejects.toThrow(/append-only/);
    await expect(
      sql.query(`delete from audit_event where id = (select min(id) from audit_event)`),
    ).rejects.toThrow(/append-only/);

    const ok = await request(t.server).get('/api/v1/audit/verify').set(bearer(superToken)).expect(200);
    expect(ok.body).toMatchObject({ ok: true, firstBrokenId: null });
    expect(ok.body.checked).toBeGreaterThan(10);
    await request(t.server).get('/api/v1/audit/verify').set(bearer(mfrAdmin)).expect(403);

    // Someone with database owner rights bypasses the trigger and edits an entry.
    const { rows } = await sql.query<{ id: string }>(
      `select id from audit_event order by id limit 1 offset 3`,
    );
    const target = Number(rows[0]!.id);
    await sql.query('alter table audit_event disable trigger audit_event_append_only');
    await sql.query(`update audit_event set metadata = '{"forged":true}' where id = $1`, [target]);
    let res = await request(t.server).get('/api/v1/audit/verify').set(bearer(superToken)).expect(200);
    expect(res.body).toMatchObject({ ok: false, firstBrokenId: target, problem: 'changed' });

    // ...or deletes it.
    await sql.query(`delete from audit_event where id = $1`, [target]);
    res = await request(t.server).get('/api/v1/audit/verify').set(bearer(superToken)).expect(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.problem).toBe('missing_or_reordered');
    expect(res.body.firstBrokenId).toBeGreaterThan(target);
    await sql.query('alter table audit_event enable trigger audit_event_append_only');
  });
});
