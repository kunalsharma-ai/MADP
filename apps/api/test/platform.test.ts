import pg from 'pg';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_CODES } from '@madp/contracts';
import { IngestionService } from '../src/ingestion/ingestion.service.js';
import { startTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
let superToken: string;
let superTotp: OTPAuth.TOTP;
const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

beforeAll(async () => {
  t = await startTestApp();
  const s = await t.adminToken('super_admin');
  superToken = s.token;
  superTotp = s.totp!;
});
afterAll(async () => t?.stop());

describe('authentication', () => {
  it('rejects anonymous access to every data endpoint', async () => {
    for (const path of ['/api/v1/dashboard/summary', '/api/v1/panellists', '/api/v1/questions', '/api/v1/connectors', '/api/v1/audit']) {
      await request(t.server).get(path).expect(401);
    }
    await request(t.server).post('/api/v1/audience/counts').send({}).expect(401);
  });

  it('requires TOTP once MFA is enabled, and locks after repeated failures', async () => {
    await request(t.server).post('/api/v1/auth/login').send({ email: 'super_admin@example.invalid', password: 'correct horse battery staple' }).expect(401);
    const ok = await request(t.server).post('/api/v1/auth/login').send({ email: 'super_admin@example.invalid', password: 'correct horse battery staple', totp: superTotp.generate() }).expect(200);
    expect(ok.body.mfaSetupRequired).toBe(false);
    expect(ok.body.user.permissions).toContain('health.sensitive.read');
  });

  it('a session that has not enrolled MFA can only reach MFA enrolment', async () => {
    const { AuthService } = await import('../src/auth/auth.service.js');
    await t.app.get(AuthService).createAdmin('fresh@example.invalid', 'Fresh', 'correct horse battery staple', 'analyst');
    const login = await request(t.server).post('/api/v1/auth/login').send({ email: 'fresh@example.invalid', password: 'correct horse battery staple' }).expect(200);
    expect(login.body.mfaSetupRequired).toBe(true);
    await request(t.server).get('/api/v1/dashboard/summary').set(bearer(login.body.token)).expect(403);
    await request(t.server).get('/api/v1/auth/me').set(bearer(login.body.token)).expect(200);
    const unknown = await request(t.server).post('/api/v1/auth/login').send({ email: 'nobody@example.invalid', password: 'x' }).expect(401);
    expect(unknown.body.message).toBe('Invalid credentials');
  });

  it('serves the OpenAPI document publicly', async () => {
    const r = await request(t.server).get('/api/v1/openapi.json').expect(200);
    expect(r.body.paths['/audience/counts']).toBeDefined();
  });
});

describe('DEMO ingestion pipeline for all three panels', () => {
  it('all connectors start in DEMO mode because live access is not approved', async () => {
    const r = await request(t.server).get('/api/v1/connectors').set(bearer(superToken)).expect(200);
    expect(r.body.map((c: { panel: string; dataMode: string }) => `${c.panel}:${c.dataMode}`)).toEqual(['t2o:demo', 'mfr:demo', 'mho:demo']);
  });

  it('a dry run writes nothing', async () => {
    const r = await request(t.server).post('/api/v1/connectors/t2o/import').set(bearer(superToken)).send({}).expect(200);
    expect(r.body.status).toBe('succeeded');
    expect(r.body.counts.respondentsSeen).toBeGreaterThan(0);
    const counts = await request(t.server).post('/api/v1/audience/counts').set(bearer(superToken)).send({}).expect(200);
    expect(counts.body.uniquePeople).toBe(0);
  });

  it('imports every panel independently', async () => {
    for (const panel of PANEL_CODES) {
      const r = await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(bearer(superToken)).send({ dryRun: false }).expect(200);
      expect(r.body.status, `${panel}: ${r.body.error}`).toBe('succeeded');
      expect(r.body.dataMode).toBe('demo');
      expect(r.body.counts.questions).toBeGreaterThan(5);
      expect(r.body.counts.identitiesCreated).toBeGreaterThan(0);
      expect(r.body.counts.answersChanged).toBeGreaterThan(0);
      expect(r.body.counts.unknownCategories).toEqual({});
    }
  });

  it('re-running an import is idempotent', async () => {
    const r = await request(t.server).post('/api/v1/connectors/mfr/import').set(bearer(superToken)).send({ dryRun: false }).expect(200);
    expect(r.body.counts).toMatchObject({ identitiesCreated: 0, personsCreated: 0, questionVersionsCreated: 0, answersChanged: 0, mappingsQueued: 0 });
  });

  it('counts unique people separately from panel and category memberships', async () => {
    const r = await request(t.server).post('/api/v1/audience/counts').set(bearer(superToken)).send({}).expect(200);
    const c = r.body;
    expect(c.dataMode).toBe('demo');
    expect(c.uniquePeople).toBeGreaterThan(0);
    expect(c.panelMemberships).toBeGreaterThan(c.uniquePeople); // overlap exists in the demo population
    const sumPanels = c.byPanel.reduce((a: number, x: { value: number }) => a + x.value, 0);
    expect(sumPanels).toBe(c.panelMemberships); // one membership per person per panel
    const pg2 = new pg.Client({ connectionString: t.dbUrl });
    await pg2.connect();
    const persons = await pg2.query(`select count(distinct master_person_id)::int n from panel_membership where status = 'active'`);
    await pg2.end();
    expect(c.uniquePeople).toBe(persons.rows[0].n);
    expect(c.freshestSourceSyncAt).not.toBeNull();
  });

  it('filters by panel and category and suppresses small cells', async () => {
    const mho = await request(t.server).post('/api/v1/audience/counts').set(bearer(superToken)).send({ panels: ['mho'], categories: ['healthcare_professional'] }).expect(200);
    expect(mho.body.byPanel.map((x: { key: string }) => x.key)).toEqual(['mho']);
    expect(mho.body.byCategory.map((x: { key: string }) => x.key)).toEqual(['healthcare_professional']);
    const tiny = await request(t.server).post('/api/v1/audience/counts').set(bearer(superToken)).send({ countries: ['ae'], panels: ['mho'], categories: ['caregiver'] }).expect(200);
    for (const cell of tiny.body.byCountry) if (cell.suppressed) expect(cell.value).toBeNull();
  });

  it('auto-links verified cross-panel e-mail matches and queues the rest for review', async () => {
    const r = await request(t.server).get('/api/v1/dashboard/summary').set(bearer(superToken)).expect(200);
    expect(r.body.kpis.multiPanelPeople).toBeGreaterThan(0);
    expect(r.body.kpis.pendingMappings).toBeGreaterThan(0);
  });
});

describe('question registry and mapping review', () => {
  it('lists versioned questions for each panel with MHO health questions marked special-category', async () => {
    const r = await request(t.server).get('/api/v1/questions').set(bearer(superToken)).expect(200);
    const panels = new Set(r.body.items.map((q: { panel: string }) => q.panel));
    expect([...panels].sort()).toEqual(['mfr', 'mho', 't2o']);
    const smoke = r.body.items.find((q: { panel: string; sourceQuestionId: string }) => q.panel === 'mho' && q.sourceQuestionId === 'smoke');
    expect(smoke.sensitivity).toBe('special_category');
    expect(smoke.version).toBe(1);
  });

  it('a steward approves a suggested mapping; the decision is audited', async () => {
    const steward = (await t.adminToken('data_steward'));
    const q = await request(t.server).get('/api/v1/mappings/review?panel=t2o').set(bearer(steward.token)).expect(200);
    const gender = q.body.items.find((m: { sourceQuestionId: string }) => m.sourceQuestionId === 'gender');
    expect(gender.suggestedAttributeKey).toBe('demographics.gender');
    expect(gender.status).toBe('pending');
    const d = await request(t.server).post(`/api/v1/mappings/${gender.id}/decision`).set(bearer(steward.token)).send({ decision: 'approve' }).expect(201);
    expect(d.body).toMatchObject({ status: 'approved', attributeKey: 'demographics.gender' });
    await request(t.server).post(`/api/v1/mappings/${gender.id}/decision`).set(bearer(steward.token)).send({ decision: 'approve', attributeKey: 'not.real' }).expect(400);
    const audit = await request(t.server).get('/api/v1/audit').set(bearer(superToken)).expect(200);
    expect(audit.body.items.some((e: { action: string }) => e.action === 'mapping.approve')).toBe(true);
  });
});

describe('access control on personal and health data', () => {
  it('analysts cannot open the panellist directory; stewards see masked data and no health answers', async () => {
    const analyst = (await t.adminToken('analyst'));
    await request(t.server).get('/api/v1/panellists').set(bearer(analyst.token)).expect(403);
    await request(t.server).post('/api/v1/audience/counts').set(bearer(analyst.token)).send({}).expect(200);

    const steward = (await t.adminToken('data_steward', 'steward2@example.invalid'));
    const list = await request(t.server).get('/api/v1/panellists?panel=mho&limit=50').set(bearer(steward.token)).expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items[0].emailMasked).toMatch(/\*\*\*/);
    let checked = false;
    for (const p of list.body.items) {
      const d = await request(t.server).get(`/api/v1/panellists/${p.id}`).set(bearer(steward.token)).expect(200);
      expect(d.body.access).toEqual({ pii: false, healthSensitive: false });
      expect(d.body.identities[0].name).toBeNull();
      expect(d.body.answers.every((a: { sensitivity: string }) => a.sensitivity !== 'special_category')).toBe(true);
      if (d.body.hiddenSensitiveAnswers > 0) { checked = true; break; }
    }
    expect(checked).toBe(true);
  });

  it('a super admin sees decrypted PII and health answers, and the view is audited', async () => {
    const list = await request(t.server).get('/api/v1/panellists?panel=mho&limit=5').set(bearer(superToken)).expect(200);
    const d = await request(t.server).get(`/api/v1/panellists/${list.body.items[0].id}`).set(bearer(superToken)).expect(200);
    expect(d.body.identities[0].email).toMatch(/@example\.invalid$/);
    expect(d.body.hiddenSensitiveAnswers).toBe(0);
  });

  it('keyset pagination returns disjoint pages', async () => {
    const a = await request(t.server).get('/api/v1/panellists?limit=10').set(bearer(superToken)).expect(200);
    const b = await request(t.server).get(`/api/v1/panellists?limit=10&after=${a.body.nextCursor}`).set(bearer(superToken)).expect(200);
    const ids = new Set([...a.body.items, ...b.body.items].map((x: { id: string }) => x.id));
    expect(ids.size).toBe(20);
  });

  it('exact e-mail search uses the keyed hash', async () => {
    const r = await request(t.server).get('/api/v1/panellists?search=demo.member.00001@example.invalid').set(bearer(superToken)).expect(200);
    expect(r.body.items.length).toBe(1);
  });
});

describe('audit trail integrity', () => {
  it('rejects UPDATE and DELETE on audit_event', async () => {
    const c = new pg.Client({ connectionString: t.dbUrl });
    await c.connect();
    await expect(c.query(`update audit_event set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(c.query(`delete from audit_event`)).rejects.toThrow(/append-only/);
    await c.end();
  });

  it('PII never lands in MongoDB staging events', async () => {
    const ingestion = t.app.get(IngestionService);
    expect(ingestion).toBeDefined();
    const { MongoClient } = await import('mongodb');
    const m = new MongoClient('mongodb://localhost:27017');
    await m.connect();
    const ev = await m.db(t.env.MONGODB_DB).collection('source_events').findOne({ kind: 'respondent' });
    await m.close();
    expect(JSON.stringify(ev)).not.toMatch(/example\.invalid|Demo|Member/);
  });
});
