import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { DemoConnector } from '@madp/connectors';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { Database } from '../src/db/database.js';
import { Mongo } from '../src/mongo/mongo.js';
import { startTestApp } from './helpers.js';

/**
 * Privacy requests on DEMO data for all three panels: logging, a second person verifying and carrying out,
 * access exports, restriction, correction, and deletion that erases MADP's copy, holds the member out of later
 * syncs and completes when the panel's deletions feed confirms it. Retention keeps evidence.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;
const demo = (panel: 't2o' | 'mfr' | 'mho') => t.app.get(ConnectorRegistry).get(panel).connector as DemoConnector;
const api = (who: string, method: 'get' | 'post', path: string, body?: object) => {
  const r = request(t.server)[method](`/api/v1/privacy${path}`).set(as(who));
  return body ? r.send(body) : r;
};
const note = { note: 'Checked the requester against the panel account' };

/** A person with an active membership on a panel and no other open request. */
async function person(panel: 't2o' | 'mfr' | 'mho', exclude: string[] = []) {
  const rows = await q<{ person: string; member: string }>(sql`
    select pm.master_person_id as person, si.source_member_id as member from panel_membership pm
    join source_identity si on si.id = pm.source_identity_id
    where pm.panel = ${panel} and pm.status = 'active' and si.email_enc is not null order by pm.id`);
  // Prefer someone with answers, so erasing them is visible.
  for (const r of rows.filter((x) => !exclude.includes(x.person)))
    if (await t.app.get(Mongo).profileAnswers.countDocuments({ panel, sourceMemberId: r.member })) return r;
  return rows.find((r) => !exclude.includes(r.person))!;
}

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '90' });
  for (const role of ['super_admin', 'privacy_officer', 'support', 'data_steward'] as const) tok[role] = (await t.adminToken(role)).token;
  tok.privacy2 = (await t.adminToken('privacy_officer', 'privacy2@example.invalid')).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

describe('deletion', () => {
  it('needs a second person, erases MADP’s copy, keeps the member out of syncs, and completes when the panel deletes', async () => {
    const p = await person('t2o');
    await api('data_steward', 'post', '/requests', { personId: p.person, kind: 'deletion', reference: 'Ticket 901' }).expect(403);
    const r = await api('support', 'post', '/requests', { personId: p.person, kind: 'deletion', panels: ['t2o'], reference: 'Ticket 901', jurisdiction: 'IN-DPDP' }).expect(201);
    expect(r.body).toMatchObject({ status: 'received', panels: ['t2o'] });
    await api('support', 'post', '/requests', { personId: p.person, kind: 'deletion', panels: ['t2o'], reference: 'Ticket 902' }).expect(409);
    const id = r.body.id;
    await api('support', 'post', `/requests/${id}/verify`, note).expect(403); // no privacy.execute
    await api('privacy_officer', 'post', `/requests/${id}/execute`, note).expect(409); // not verified yet
    await api('privacy_officer', 'post', `/requests/${id}/verify`, note).expect(200);

    const answersBefore = await t.app.get(Mongo).profileAnswers.countDocuments({ panel: 't2o', sourceMemberId: p.member });
    expect(answersBefore).toBeGreaterThan(0);
    const done = await api('privacy2', 'post', `/requests/${id}/execute`, { note: 'Erased in MADP' }).expect(200);
    expect(done.body).toMatchObject({ status: 'awaiting_panel', holds: [{ panel: 't2o', panelDeletedAt: null }] });
    const [si] = await q<{ email_enc: string | null; status: string }>(sql`
      select si.email_enc, pm.status from source_identity si join panel_membership pm on pm.source_identity_id = si.id
      where si.panel = 't2o' and si.source_member_id = ${p.member}`);
    expect(si).toEqual({ email_enc: null, status: 'deleted' });
    expect(await t.app.get(Mongo).profileAnswers.countDocuments({ panel: 't2o', sourceMemberId: p.member })).toBe(0);

    // The panel still has the member: a re-import must not bring the data back.
    const again = await request(t.server).post('/api/v1/connectors/t2o/import').set(as('super_admin')).send({ dryRun: false }).expect(200);
    expect(again.body.counts.erasureHeld).toBe(1);
    const [still] = await q<{ email_enc: string | null; status: string }>(sql`
      select si.email_enc, pm.status from source_identity si join panel_membership pm on pm.source_identity_id = si.id
      where si.panel = 't2o' and si.source_member_id = ${p.member}`);
    expect(still).toEqual({ email_enc: null, status: 'deleted' });
    expect(await t.app.get(Mongo).profileAnswers.countDocuments({ panel: 't2o', sourceMemberId: p.member })).toBe(0);

    // The panel deletes the member; its deletions feed closes the request.
    demo('t2o').deletionsOverride = [{ panel: 't2o', sourceMemberId: p.member, kind: 'member', at: new Date().toISOString() }];
    try {
      await request(t.server).post('/api/v1/connectors/t2o/sync').set(as('super_admin')).expect(200);
    } finally {
      demo('t2o').deletionsOverride = null;
    }
    const closed = await api('support', 'get', `/requests/${id}`).expect(200);
    expect(closed.body.status).toBe('completed');
    expect(closed.body.events.map((e: { action: string }) => e.action)).toEqual(['received', 'verified', 'carried_out_in_madp', 'panel_deleted', 'completed']);
    await expect(q(sql`delete from privacy_request_event where request_id = ${id}`)).rejects.toThrow();
  });

  it('never lets the person who logged a request verify or carry it out', async () => {
    const p = await person('mfr');
    const r = await api('privacy_officer', 'post', '/requests', { personId: p.person, kind: 'deletion', panels: ['mfr'], reference: 'Email 77' }).expect(201);
    await api('privacy_officer', 'post', `/requests/${r.body.id}/verify`, note).expect(403);
    await api('privacy2', 'post', `/requests/${r.body.id}/reject`, { note: 'Could not verify the requester' }).expect(200);
    await api('privacy2', 'post', `/requests/${r.body.id}/execute`, note).expect(409);
  });
});

describe('access, restriction and correction', () => {
  it('exports the person’s own data, decrypted, only for a verified access request, and audits it', async () => {
    const p = await person('mho');
    const r = await api('support', 'post', '/requests', { personId: p.person, kind: 'access', reference: 'Ticket 950' }).expect(201);
    await api('privacy_officer', 'get', `/requests/${r.body.id}/export`).expect(400);
    await api('privacy_officer', 'post', `/requests/${r.body.id}/verify`, note).expect(200);
    await api('support', 'get', `/requests/${r.body.id}/export`).expect(403);
    const x = await api('privacy_officer', 'get', `/requests/${r.body.id}/export`).expect(200);
    expect(x.body.dataMode).toBe('demo');
    expect(x.body.identities.length).toBeGreaterThan(0);
    expect(x.body.identities[0].email).toMatch(/@example\.invalid$/);
    expect(x.body.consents.length).toBeGreaterThan(0);
    expect(Array.isArray(x.body.answers)).toBe(true);
    await api('privacy2', 'post', `/requests/${r.body.id}/execute`, { note: 'Sent to the member' }).expect(200);
    const [a] = await q<{ n: string }>(sql`select count(*) as n from audit_event where action = 'privacy.export_generated' and target_id = ${r.body.id}`);
    expect(a!.n).toBe('1');
  });

  it('restriction stops all contact on every panel of the request', async () => {
    const p = await person('mfr', []);
    const r = await api('support', 'post', '/requests', { personId: p.person, kind: 'restriction', reference: 'Ticket 960' }).expect(201);
    await api('privacy_officer', 'post', `/requests/${r.body.id}/verify`, note).expect(200);
    const res = await api('privacy2', 'post', `/requests/${r.body.id}/execute`, { note: 'Restricted' }).expect(200);
    expect(res.body.status).toBe('completed');
    const c = await request(t.server).get(`/api/v1/consent/persons/${p.person}`).set(as('privacy_officer')).expect(200);
    expect(c.body.optedOut).toEqual(expect.arrayContaining(['mfr:all']));
  });

  it('a correction waits for the panel and is closed by hand', async () => {
    const p = await person('mho', []);
    const r = await api('support', 'post', '/requests', { personId: p.person, kind: 'correction', panels: ['mho'], reference: 'Ticket 970', dueInDays: 1 }).expect(201);
    await q(sql`update privacy_request set due_at = now() - interval '1 hour' where id = ${r.body.id}`);
    const list = await api('support', 'get', '/requests').expect(200);
    expect(list.body.overdue).toBeGreaterThanOrEqual(1);
    expect(list.body.requests.find((x: { id: string }) => x.id === r.body.id).overdue).toBe(true);
    await api('privacy_officer', 'post', `/requests/${r.body.id}/verify`, note).expect(200);
    expect((await api('privacy2', 'post', `/requests/${r.body.id}/execute`, { note: 'Asked the panel' }).expect(200)).body.status).toBe('awaiting_panel');
    await api('privacy_officer', 'post', `/requests/${r.body.id}/complete`, { note: 'Panel corrected the city' }).expect(200);
    await api('privacy_officer', 'post', `/requests/${r.body.id}/complete`, note).expect(409);
  });
});

describe('retention', () => {
  it('shows the schedule, keeps evidence, and purges only technical rows', async () => {
    const r = await api('support', 'get', '/retention').expect(200);
    expect(r.body.rules.map((x: { key: string }) => x.key)).toEqual(['service_idempotency', 'dry_run_events', 'audit_event', 'consent_event', 'reward_ledger']);
    await api('privacy_officer', 'post', '/retention/audit_event/purge').expect(403);
    await api('support', 'post', '/retention/service_idempotency/purge').expect(403);
    expect((await api('privacy_officer', 'post', '/retention/service_idempotency/purge').expect(200)).body).toEqual({ key: 'service_idempotency', removed: 0 });
  });
});
