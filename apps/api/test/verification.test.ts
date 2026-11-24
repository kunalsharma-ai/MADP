import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { IngestionService } from '../src/ingestion/ingestion.service.js';
import { startTestApp } from './helpers.js';

/**
 * Verification and data quality center (screen 8) on DEMO data for all three panels: source-reported verification
 * and quality, MADP's own checks with a drill-down that holds no personal data, brand scoping, four-eyes evidence,
 * expiry and revocation, and erasure of evidence with the membership.
 */
type Panel = 't2o' | 'mfr' | 'mho';
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string, brand?: string) => ({
  authorization: `Bearer ${tok[who]}`,
  ...(brand ? { 'x-madp-brand': brand } : {}),
});
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;
const get = (who: string, path: string, brand?: string) => request(t.server).get(`/api/v1/verification${path}`).set(as(who, brand));
const post = (who: string, path: string, body: object, brand?: string) =>
  request(t.server).post(`/api/v1/verification${path}`).set(as(who, brand)).send(body);

async function members(panel: Panel, n: number, where = sql`true`) {
  return q<{ person: string; identity: string; member: string }>(sql`
    select m.master_person_id as person, s.id as identity, s.source_member_id as member
    from panel_membership m join source_identity s on s.id = m.source_identity_id
    where m.panel = ${panel} and m.status = 'active' and s.email_hash is not null and ${where} order by m.id limit ${n}`);
}
type Summary = { panels: { panel: Panel; members: number; checks: Record<string, number>; evidence: Record<string, Record<string, number>> }[] };
const panelOf = (s: Summary, p: Panel) => s.panels.find((x) => x.panel === p)!;

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60' });
  for (const role of ['super_admin', 'data_steward', 'privacy_officer', 'panel_manager', 'read_only_analyst'] as const)
    tok[role] = (await t.adminToken(role)).token;
  tok.mfrSteward = (await t.adminToken('data_steward', 'mfr.steward@example.invalid', ['mfr'])).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

describe('verification and data quality', () => {
  it('reports source-reported verification, quality and MADP checks for every panel', async () => {
    const before = (await get('data_steward', '/summary').expect(200)).body as Summary;
    expect(before.panels.map((p) => p.panel)).toEqual(['t2o', 'mfr', 'mho']);
    for (const p of before.panels) expect(p.members).toBeGreaterThan(0);

    // Plant one problem per panel.
    const [t2o] = await members('t2o', 1);
    const [mfrA, mfrB] = await members('mfr', 2);
    const [mho] = await members('mho', 1, sql`s.quality_score >= 100`);
    await q(sql`update source_identity set timezone = 'Mars/Olympus' where id = ${t2o!.identity}`);
    await q(sql`update source_identity set birth_year = 1850 where id = ${mfrA!.identity}`);
    await q(sql`update source_identity set email_hash = (select email_hash from source_identity where id = ${mfrA!.identity}) where id = ${mfrB!.identity}`);
    await q(sql`update source_identity set quality_score = 40 where id = ${mho!.identity}`);

    const after = (await get('data_steward', '/summary').expect(200)).body as Summary;
    expect(panelOf(after, 't2o').checks.unknown_timezone).toBe(panelOf(before, 't2o').checks.unknown_timezone! + 1);
    expect(panelOf(after, 'mfr').checks.implausible_age).toBe(panelOf(before, 'mfr').checks.implausible_age! + 1);
    expect(panelOf(after, 'mfr').checks.shared_email_in_panel).toBeGreaterThanOrEqual(2);
    expect(panelOf(after, 'mho').checks.quality_below_default).toBe(panelOf(before, 'mho').checks.quality_below_default! + 1);

    const drill = await get('data_steward', '/checks?panel=t2o&check=unknown_timezone').expect(200);
    expect(drill.body.items.map((i: { personId: string }) => i.personId)).toContain(t2o!.person);
    expect(drill.body.items.find((i: { personId: string }) => i.personId === t2o!.person).timezone).toBe('Mars/Olympus');
    // Masked panel ids, and no e-mail, phone or names anywhere.
    const text = JSON.stringify(drill.body);
    expect(text).not.toContain(t2o!.member);
    expect(text).not.toMatch(/@|email_hash|first_?name|phone/i);
    const age = await get('data_steward', '/checks?panel=mfr&check=implausible_age').expect(200);
    expect(age.body.items.map((i: { personId: string }) => i.personId)).toContain(mfrA!.person);
    const low = await get('data_steward', '/checks?panel=mho&check=quality_below_default').expect(200);
    expect(low.body.items.find((i: { personId: string }) => i.personId === mho!.person).qualityScore).toBe(40);
  });

  it('counts each check in the summary exactly as the drill-down finds it, per panel', async () => {
    // An e-mail shared across two panels is not a duplicate in either.
    const [mfr] = await members('mfr', 1);
    const [mho] = await members('mho', 1);
    const before = (await get('data_steward', '/summary').expect(200)).body as Summary;
    await q(sql`update source_identity set email_hash = (select email_hash from source_identity where id = ${mfr!.identity}) where id = ${mho!.identity}`);
    const s = (await get('data_steward', '/summary').expect(200)).body as Summary;
    for (const p of ['mfr', 'mho'] as const)
      expect(panelOf(s, p).checks.shared_email_in_panel).toBe(panelOf(before, p).checks.shared_email_in_panel);
    for (const p of s.panels)
      for (const [check, n] of Object.entries(p.checks)) {
        const d = await get('data_steward', `/checks?panel=${p.panel}&check=${check}&limit=200`).expect(200);
        expect(d.body.items.length, `${p.panel} ${check}`).toBe(n);
      }
    expect(s.panels.flatMap((p) => Object.values(p.checks)).some((n) => n > 0)).toBe(true);
  });

  it('checks permissions and the selected brand', async () => {
    await get('read_only_analyst', '/summary').expect(403);
    await get('panel_manager', '/summary').expect(200);
    const [m] = await members('t2o', 1);
    await post('panel_manager', '/evidence', { personId: m!.person, panel: 't2o', claim: 'identity', method: 'video_call', reference: 'Ticket 1' }).expect(403);
    // A steward granted MFR only sees MFR, cannot pick every brand, and cannot act on another brand.
    const mfr = (await get('mfrSteward', '/summary', 'mfr').expect(200)).body as Summary;
    expect(mfr.panels.map((p) => p.panel)).toEqual(['mfr']);
    await get('mfrSteward', '/summary', 'all').expect(403);
    await get('mfrSteward', '/summary?panel=t2o', 'mfr').expect(403);
    await post('mfrSteward', '/evidence', { personId: m!.person, panel: 't2o', claim: 'identity', method: 'video_call', reference: 'Ticket 1' }, 'mfr').expect(403);
  });

  it('needs a second admin to decide evidence, on every panel', async () => {
    for (const panel of ['t2o', 'mfr', 'mho'] as const) {
      const [m] = await members(panel, 1);
      const claim = panel === 'mho' ? 'hcp_licence' : 'identity';
      const r = await post('data_steward', '/evidence', {
        personId: m!.person, panel, claim, method: 'registry_lookup', reference: `Registry lookup ${panel}-77`, expiresOn: '2030-01-31',
      }).expect(201);
      expect(r.body).toMatchObject({ status: 'pending', panel, claim, personId: m!.person });
      await post('data_steward', `/evidence/${r.body.id}/decision`, { decision: 'verified', note: 'Looks right' }).expect(403);
      const d = await post('privacy_officer', `/evidence/${r.body.id}/decision`, { decision: 'verified', note: 'Registry entry matches' }).expect(200);
      expect(d.body.status).toBe('verified');
      await post('privacy_officer', `/evidence/${r.body.id}/decision`, { decision: 'rejected', note: 'Second try' }).expect(409);
      const s = (await get('data_steward', `/summary?panel=${panel}`).expect(200)).body as Summary;
      expect(panelOf(s, panel).evidence[claim]).toMatchObject({ verified: 1, pending: 0 });
    }
    // Someone who is not a member of the panel.
    const [mho] = await members('mho', 1);
    const onlyMho = await q<{ n: string }>(sql`select count(*) as n from panel_membership where master_person_id = ${mho!.person} and panel = 't2o'`);
    if (Number(onlyMho[0]!.n) === 0)
      await post('data_steward', '/evidence', { personId: mho!.person, panel: 't2o', claim: 'age', method: 'document_check', reference: 'Ticket 3' }).expect(404);
    const audit = await q<{ action: string }>(sql`select action from audit_event where action like 'verification.%'`);
    expect(audit.filter((a) => a.action === 'verification.evidence_verified')).toHaveLength(3);
  });

  it('counts expired evidence apart, and revokes and rejects', async () => {
    const [m] = await members('mfr', 1);
    const list = await get('data_steward', `/evidence?panel=mfr&personId=${m!.person}`).expect(200);
    const id = list.body.items[0].id as string;
    await q(sql`update verification_evidence set expires_on = '2020-01-01' where id = ${id}`);
    let s = (await get('data_steward', '/summary?panel=mfr').expect(200)).body as Summary;
    expect(panelOf(s, 'mfr').evidence.identity).toMatchObject({ verified: 0, expired: 1 });
    expect((await get('data_steward', `/evidence?panel=mfr&personId=${m!.person}`).expect(200)).body.items[0].expired).toBe(true);
    await post('data_steward', `/evidence/${id}/revoke`, { note: 'Licence lapsed' }).expect(200);
    await post('data_steward', `/evidence/${id}/revoke`, { note: 'Again' }).expect(409);
    s = (await get('data_steward', '/summary?panel=mfr').expect(200)).body as Summary;
    expect(panelOf(s, 'mfr').evidence.identity).toMatchObject({ revoked: 1, expired: 0 });

    const r = await post('privacy_officer', '/evidence', { personId: m!.person, panel: 'mfr', claim: 'employment', method: 'work_email', reference: 'Ticket 12' }).expect(201);
    await post('data_steward', `/evidence/${r.body.id}/decision`, { decision: 'rejected', note: 'Domain does not match' }).expect(200);
    s = (await get('data_steward', '/summary?panel=mfr').expect(200)).body as Summary;
    expect(panelOf(s, 'mfr').evidence.employment).toMatchObject({ rejected: 1 });
  });

  it('erases evidence with the membership on a privacy deletion', async () => {
    const [m] = await members('t2o', 1);
    expect((await get('data_steward', `/evidence?personId=${m!.person}`).expect(200)).body.items.length).toBeGreaterThan(0);
    await t.app.get(IngestionService).removeMember('t2o', 'demo', null, m!.member, 'privacy_request');
    const left = await q(sql`select 1 from verification_evidence e join panel_membership pm on pm.id = e.panel_membership_id
      where pm.source_identity_id = ${m!.identity}`);
    expect(left).toHaveLength(0);
  });
});
