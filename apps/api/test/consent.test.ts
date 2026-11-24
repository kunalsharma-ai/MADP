import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { startTestApp } from './helpers.js';

/**
 * Consent and preference center on DEMO data for all three panels: per-panel consent state and contactability,
 * an append-only history written on every change, and member-requested channel opt-outs that the contact gate
 * honours. MADP never grants consent.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;
const PANELS = ['t2o', 'mfr', 'mho'];
type Funnel = { memberships: number; active: number; adults: number; termsAccepted: number; usableAddress: number; notOptedOut: number; reachable: number };
type Summary = { panels: { panel: string; purposes: Record<string, Record<string, number>>; contactable: Funnel; madpOptOuts: Record<string, number>; gaps: string[] }[] };
const summary = async () => (await request(t.server).get('/api/v1/consent/summary').set(as('privacy_officer')).expect(200)).body as Summary;

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '90' });
  for (const role of ['super_admin', 'privacy_officer', 'support', 'data_steward', 'analyst'] as const) tok[role] = (await t.adminToken(role)).token;
  for (const panel of PANELS)
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

describe('consent state', () => {
  it('reports consent and contactability per panel, never added across panels, and names the gaps', async () => {
    const s = await summary();
    expect(s.panels.map((p) => p.panel)).toEqual(PANELS);
    for (const p of s.panels) {
      expect(p.purposes.terms?.granted, p.panel).toBeGreaterThan(0);
      const c = p.contactable;
      expect(c.memberships).toBeGreaterThanOrEqual(c.active);
      expect(c.active).toBeGreaterThanOrEqual(c.adults);
      expect(c.adults).toBeGreaterThanOrEqual(c.termsAccepted);
      expect(c.termsAccepted).toBeGreaterThanOrEqual(c.usableAddress);
      expect(c.usableAddress).toBeGreaterThanOrEqual(c.reachable);
      expect(c.reachable, p.panel).toBeGreaterThan(0);
      // Every panel reports the marketing opt-in (granted, denied and withdrawn), so it is not named as a gap.
      expect(p.purposes.email_marketing?.granted, p.panel).toBeGreaterThan(0);
      expect(p.purposes.email_marketing?.withdrawn, p.panel).toBeGreaterThan(0);
      expect(p.gaps.some((g) => g.includes('email marketing')), p.panel).toBe(false);
    }
    await request(t.server).get('/api/v1/consent/summary').set(as('analyst')).expect(403);
    await request(t.server).get('/api/v1/consent/summary?panel=mho').set(as('data_steward')).expect(200);
  });
});

describe('consent history', () => {
  it('records every change once, keeps it when the panel changes it again, and refuses edits', async () => {
    const first = (await q<{ n: string }>(sql`select count(*) as n from consent_event`))[0]!.n;
    const records = (await q<{ n: string }>(sql`select count(*) as n from consent_record`))[0]!.n;
    expect(first).toBe(records); // one entry per record from the first import
    await request(t.server).post('/api/v1/connectors/mfr/import').set(as('super_admin')).send({ dryRun: false }).expect(200);
    expect((await q<{ n: string }>(sql`select count(*) as n from consent_event`))[0]!.n).toBe(first); // nothing changed

    const [rec] = await q<{ person: string; purpose: string }>(sql`
      select master_person_id as person, purpose from consent_record where panel = 'mho' and status = 'granted' and purpose = 'terms' limit 1`);
    await q(sql`update consent_record set status = 'withdrawn', evidence = evidence || '{"source":"panel_sync","value":"withdrawn"}'::jsonb
      where master_person_id = ${rec!.person} and panel = 'mho' and purpose = 'terms'`);
    const ev = await request(t.server).get('/api/v1/consent/events?panel=mho&purpose=terms&limit=5').set(as('support')).expect(200);
    expect(ev.body[0]).toMatchObject({ personId: rec!.person, panel: 'mho', previousStatus: 'granted', status: 'withdrawn', source: 'panel_sync' });
    expect(JSON.stringify(ev.body)).not.toMatch(/@/);

    const person = await request(t.server).get(`/api/v1/consent/persons/${rec!.person}`).set(as('support')).expect(200);
    expect(person.body.history.filter((h: { panel: string; purpose: string }) => h.panel === 'mho' && h.purpose === 'terms').map((h: { status: string }) => h.status)).toEqual([
      'withdrawn',
      'granted',
    ]);
    const [audit] = await q<{ n: string }>(sql`select count(*) as n from audit_event where action = 'consent.person_viewed' and target_id = ${rec!.person}`);
    expect(audit!.n).toBe('1');

    await expect(q(sql`update consent_event set status = 'granted' where id = (select max(id) from consent_event)`)).rejects.toThrow();
    await expect(q(sql`delete from consent_event where id = (select max(id) from consent_event)`)).rejects.toThrow();
  });
});

describe('channel preferences', () => {
  it('records a member’s opt-out, which the contact gate and Supply360 honour, and lifts only MADP opt-outs', async () => {
    const before = (await summary()).panels.find((p) => p.panel === 't2o')!;
    // A reachable T2O member.
    const [m] = await q<{ person: string }>(sql`
      select pm.master_person_id as person from panel_membership pm join source_identity si on si.id = pm.source_identity_id
      join consent_record cr on cr.master_person_id = pm.master_person_id and cr.panel = pm.panel and cr.purpose = 'terms' and cr.status = 'granted'
      where pm.panel = 't2o' and pm.status = 'active' and si.email_enc is not null and si.email_verification is distinct from 'rejected'
        and not exists (select 1 from category_membership cm where cm.master_person_id = pm.master_person_id and cm.panel = 't2o' and cm.is_minor)
      limit 1`);
    const url = `/api/v1/consent/persons/${m!.person}/preferences`;
    const body = { panel: 't2o', channel: 'email', status: 'opted_out', source: 'support_ticket', reason: 'Ticket 4411' };
    await request(t.server).post(url).set(as('data_steward')).send(body).expect(403);
    await request(t.server).post(url).set(as('support')).send({ ...body, status: 'resumed' }).expect(409);
    await request(t.server).post(url).set(as('support')).send({ ...body, status: 'granted' }).expect(400);
    await request(t.server).post(url).set(as('support')).send(body).expect(201);
    await request(t.server).post(url).set(as('support')).send(body).expect(409);
    await request(t.server).post(`/api/v1/consent/persons/${m!.person}/preferences`).set(as('support')).send({ ...body, panel: 'zz' }).expect(400);

    const after = (await summary()).panels.find((p) => p.panel === 't2o')!;
    expect(after.contactable.notOptedOut).toBe(before.contactable.notOptedOut - 1);
    expect(after.madpOptOuts).toEqual({ email: 1 });
    const p = await request(t.server).get(`/api/v1/consent/persons/${m!.person}`).set(as('support')).expect(200);
    expect(p.body.optedOut).toEqual(['t2o:email']);

    // Lifting it restores contactability; it is a new line, the opt-out stays on record.
    await request(t.server).post(url).set(as('privacy_officer')).send({ ...body, status: 'resumed', reason: 'Member asked to resume, ticket 4420' }).expect(201);
    expect((await summary()).panels.find((x) => x.panel === 't2o')!.contactable.notOptedOut).toBe(before.contactable.notOptedOut);
    const list = await request(t.server).get('/api/v1/consent/preferences?panel=t2o').set(as('support')).expect(200);
    expect(list.body.map((r: { status: string }) => r.status)).toEqual(['resumed', 'opted_out']);
    await expect(q(sql`delete from contact_preference`)).rejects.toThrow();
    const [audit] = await q<{ n: string }>(sql`select count(*) as n from audit_event where action = 'consent.preference_recorded'`);
    expect(audit!.n).toBe('2');
  });

  it('refuses a panel the person is not a member of', async () => {
    const [m] = await q<{ person: string }>(sql`
      select master_person_id as person from panel_membership group by master_person_id having count(*) = 1 and min(panel::text) = 'mfr' limit 1`);
    await request(t.server)
      .post(`/api/v1/consent/persons/${m!.person}/preferences`)
      .set(as('support'))
      .send({ panel: 'mho', channel: 'all', status: 'opted_out', source: 'member_request', reason: 'Asked by phone' })
      .expect(404);
  });
});
