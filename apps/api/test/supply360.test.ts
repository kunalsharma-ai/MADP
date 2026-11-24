import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { signServiceRequest } from '../src/supply360/signature.js';
import { startTestApp } from './helpers.js';

/**
 * Supply360 as a signed service client on DEMO data for all three panels: request signing, replay and scope
 * checks, counts and match without personal data, reservations, invitation authorisation against the contact
 * gate, participation events and consent checks.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;

interface Client {
  id: string;
  clientId: string;
  secret: string;
}
const ALL = ['attributes.read', 'audience.counts', 'audience.match', 'reservations.write', 'invitations.authorize', 'participation.write', 'consent.check', 'integrations.health'];
const PANELS = ['t2o', 'mfr', 'mho'];

async function newClient(body: Record<string, unknown>): Promise<Client> {
  const r = await request(t.server)
    .post('/api/v1/service-clients')
    .set(as('platform_admin'))
    .send({ name: `Supply360 ${randomBytes(3).toString('hex')}`, scopes: ALL, panels: PANELS, ...body })
    .expect(201);
  return { id: r.body.id, clientId: r.body.clientId, secret: r.body.secret };
}

interface CallOpts {
  ts?: number;
  nonce?: string;
  key?: string;
  signWith?: string;
  signedBody?: string;
}
function call(c: Client, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, o: CallOpts = {}) {
  const full = `/api/v1/supply360${path}`;
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
  const nonce = o.nonce ?? randomBytes(12).toString('hex');
  const sig = signServiceRequest(o.signWith ?? c.secret, ts, nonce, method, full, o.signedBody ?? raw);
  let r = (method === 'GET' ? request(t.server).get(full) : method === 'POST' ? request(t.server).post(full) : request(t.server).delete(full))
    .set('x-madp-client', c.clientId)
    .set('x-madp-timestamp', ts)
    .set('x-madp-nonce', nonce)
    .set('x-madp-signature', sig);
  if (o.key) r = r.set('idempotency-key', o.key);
  return body === undefined ? r : r.set('content-type', 'application/json').send(raw);
}

let main: Client;
let other: Client;

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '120' });
  for (const role of ['super_admin', 'platform_admin', 'analyst'] as const) tok[role] = (await t.adminToken(role)).token;
  for (const panel of PANELS)
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
  main = await newClient({});
  other = await newClient({ panels: ['t2o'] });
});
afterAll(async () => t?.stop());

describe('service clients', () => {
  it('shows the secret once, keeps it encrypted, and only admins with users.manage manage clients', async () => {
    expect(main.secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(main.clientId).toMatch(/^s360_/);
    const list = await request(t.server).get('/api/v1/service-clients').set(as('platform_admin')).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(main.secret);
    expect(list.body.find((c: { id: string }) => c.id === main.id)).not.toHaveProperty('secretEnc');
    const [row] = await q<{ secret_enc: string }>(sql`select secret_enc from service_client where id = ${main.id}`);
    expect(row!.secret_enc).not.toContain(main.secret);
    await request(t.server).get('/api/v1/service-clients').set(as('analyst')).expect(403);
    await request(t.server).post('/api/v1/service-clients').set(as('analyst')).send({ name: 'x', scopes: ALL, panels: PANELS }).expect(403);
    // A Supply360 route never accepts an admin session in place of a signature.
    await request(t.server).get('/api/v1/supply360/attributes').set(as('super_admin')).expect(401);
  });
});

describe('request signing', () => {
  it('refuses unsigned, wrongly signed, stale, replayed, out-of-scope, revoked and over-limit requests, and audits each', async () => {
    await request(t.server).get('/api/v1/supply360/attributes').expect(401);
    await call(main, 'GET', '/attributes', undefined, { signWith: 'not-the-secret' }).expect(401);
    await call(main, 'POST', '/counts', { panels: ['t2o'] }, { signedBody: '{"panels":["mfr"]}' }).expect(401);
    await call(main, 'GET', '/attributes', undefined, { ts: Math.floor(Date.now() / 1000) - 301 }).expect(401);
    const nonce = randomBytes(12).toString('hex');
    await call(main, 'GET', '/attributes', undefined, { nonce }).expect(200);
    await call(main, 'GET', '/attributes', undefined, { nonce }).expect(401);

    const narrow = await newClient({ scopes: ['audience.counts'], panels: ['mfr'] });
    await call(narrow, 'GET', '/attributes').expect(403);
    await call(narrow, 'POST', '/counts', { panels: ['t2o'] }).expect(403); // panel outside the client's grant
    await call(narrow, 'POST', '/counts', {}).expect(200);

    const slow = await newClient({ rateLimitPerMinute: 2 });
    await call(slow, 'GET', '/attributes').expect(200);
    await call(slow, 'GET', '/attributes').expect(200);
    await call(slow, 'GET', '/attributes').expect(429);

    await request(t.server).post(`/api/v1/service-clients/${narrow.id}/revoke`).set(as('platform_admin')).expect(200);
    await call(narrow, 'POST', '/counts', {}).expect(401);
    await request(t.server).post(`/api/v1/service-clients/${narrow.id}/revoke`).set(as('platform_admin')).expect(404);

    const reasons = (await q<{ reason: string }>(sql`
      select metadata->>'reason' as reason from audit_event where action = 'service.rejected'`)).map((r) => r.reason);
    expect(reasons).toEqual(
      expect.arrayContaining(['bad_signature', 'stale_timestamp', 'replayed_nonce', 'missing_scope:attributes.read', 'rate_limited', 'revoked', 'unknown_client']),
    );
  });
});

describe('catalogue, counts and match', () => {
  it('lists no special-category attributes without the health scope', async () => {
    const plain = await call(main, 'GET', '/attributes').expect(200);
    expect(plain.body.attributes.length).toBeGreaterThan(0);
    expect(plain.body.attributes.some((a: { sensitivity: string }) => a.sensitivity === 'special_category')).toBe(false);
    const health = await newClient({ scopes: ['attributes.read', 'audience.counts'] });
    await call(health, 'GET', '/attributes').expect(200);
    const withHealth = await newClient({ scopes: ['attributes.read', 'audience.counts', 'health.aggregate'] });
    const h = await call(withHealth, 'GET', '/attributes').expect(200);
    expect(h.body.attributes.some((a: { sensitivity: string }) => a.sensitivity === 'special_category')).toBe(true);

    const religion = { attributes: [{ key: 'demographics.religion', values: ['x'] }] };
    await call(health, 'POST', '/counts', { ...religion, purpose: 'study_feasibility' }).expect(403);
    await call(withHealth, 'POST', '/counts', { ...religion, purpose: 'participant_support' }).expect(403);
    await call(withHealth, 'POST', '/counts', { ...religion, purpose: 'study_feasibility' }).expect(200);
  });

  it('counts all three panels separately', async () => {
    const r = await call(main, 'POST', '/counts', {}).expect(200);
    expect(r.body.dataMode).toBe('demo');
    for (const p of PANELS) expect(JSON.stringify(r.body)).toContain(p);
    expect(JSON.stringify(r.body)).not.toMatch(/@example\.invalid/);
  });

  it('returns eligible members as stable pseudonymous refs on all three panels, with no personal data', async () => {
    const a = await call(main, 'POST', '/match', { projectRef: 'PRJ-1001', limit: 5000 }).expect(200);
    expect(a.body).toMatchObject({ dataMode: 'demo', projectRef: 'PRJ-1001', suppressed: false });
    expect(a.body.returned).toBeGreaterThan(0);
    expect(new Set(a.body.members.map((m: { panel: string }) => m.panel))).toEqual(new Set(PANELS));
    for (const m of a.body.members) {
      expect(Object.keys(m).sort()).toEqual(['categories', 'country', 'panel', 'ref']);
      expect(m.ref).toMatch(/^ref_/);
    }
    // Refs are random, so leave them out before looking for anything that reads like personal data.
    const text = JSON.stringify(a.body).replace(/ref_[A-Za-z0-9_-]+/g, 'ref');
    expect(text).not.toMatch(/@|demo-m|email|phone|name/i);
    // Minors, missing terms and no address are excluded with a reason.
    expect(Object.keys(a.body.excluded).length).toBeGreaterThan(0);

    const again = await call(main, 'POST', '/match', { projectRef: 'PRJ-1001', limit: 5000 }).expect(200);
    expect(again.body.members.map((m: { ref: string }) => m.ref)).toEqual(a.body.members.map((m: { ref: string }) => m.ref));
    // Refs belong to one client: another client gets different refs for the same people.
    const b = await call(other, 'POST', '/match', { projectRef: 'PRJ-1001', limit: 5000 }).expect(200);
    const mine = new Set(a.body.members.map((m: { ref: string }) => m.ref));
    expect(b.body.members.some((m: { ref: string }) => mine.has(m.ref))).toBe(false);
    expect(b.body.members.every((m: { panel: string }) => m.panel === 't2o')).toBe(true);
  });

  it('returns no refs below the minimum cell and refuses health criteria', async () => {
    const few = await call(main, 'POST', '/match', { projectRef: 'PRJ-1002', countries: ['ZZ'] }).expect(200);
    expect(few.body).toMatchObject({ suppressed: true, eligible: null, returned: 0, members: [] });
    const withHealth = await newClient({ scopes: ['audience.match', 'health.aggregate'] });
    await call(withHealth, 'POST', '/match', { projectRef: 'PRJ-1002', attributes: [{ key: 'demographics.religion', values: ['x'] }] }).expect(403);
  });
});

describe('reservations, invitations, participation and consent', () => {
  let refs: string[] = [];
  let reservationId = '';
  let invitations: string[] = [];
  const expires = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

  it('holds members for one project, refuses holds by others, and is idempotent', async () => {
    const m = await call(main, 'POST', '/match', { projectRef: 'PRJ-2001', panels: ['t2o'], limit: 6 }).expect(200);
    refs = m.body.members.map((x: { ref: string }) => x.ref);
    expect(refs.length).toBe(6);
    await call(main, 'POST', '/reservations', { projectRef: 'PRJ-2001', refs, expiresAt: new Date(Date.now() + 15 * 86_400_000).toISOString() }).expect(400);
    const body = { projectRef: 'PRJ-2001', refs: [...refs, 'ref_unknownunknown12'], expiresAt: expires() };
    const r = await call(main, 'POST', '/reservations', body, { key: 'res-PRJ-2001-a' }).expect(201);
    expect(r.body).toMatchObject({ held: 6, refused: [{ ref: 'ref_unknownunknown12', reason: 'unknown_ref' }] });
    reservationId = r.body.reservationId;
    const same = await call(main, 'POST', '/reservations', body, { key: 'res-PRJ-2001-a' }).expect(201);
    expect(same.body.reservationId).toBe(reservationId);
    await call(main, 'POST', '/reservations', { ...body, projectRef: 'PRJ-2002' }, { key: 'res-PRJ-2001-a' }).expect(409);
    expect((await q<{ n: string }>(sql`select count(*) as n from audience_reservation where project_ref = 'PRJ-2001'`))[0]!.n).toBe('1');

    // Another project's match leaves the held members out, and its hold on them is refused.
    const elsewhere = await call(main, 'POST', '/match', { projectRef: 'PRJ-2002', panels: ['t2o'], limit: 5000 }).expect(200);
    expect(elsewhere.body.excluded.reserved_elsewhere).toBe(6);
    const clash = await call(main, 'POST', '/reservations', { projectRef: 'PRJ-2002', refs: refs.slice(0, 2), expiresAt: expires() }).expect(201);
    expect(clash.body).toMatchObject({ held: 0, refused: [{ reason: 'reserved_elsewhere' }, { reason: 'reserved_elsewhere' }] });

    const got = await call(main, 'GET', `/reservations/${reservationId}`).expect(200);
    expect(got.body).toMatchObject({ status: 'active', held: 6, projectRef: 'PRJ-2001' });
    await call(other, 'GET', `/reservations/${reservationId}`).expect(404);
  });

  it('authorises invitations only for reserved members who still pass the contact rules', async () => {
    // One member opts out after the hold.
    const [opt] = await q<{ person: string }>(sql`
      select pm.master_person_id as person from reservation_member rm join panel_membership pm on pm.id = rm.panel_membership_id
      where rm.reservation_id = ${reservationId} and rm.ref = ${refs[0]!}`);
    await q(sql`insert into communication_event (data_mode, master_person_id, panel, channel, state, dry_run, occurred_at)
      values ('demo', ${opt!.person}, 't2o', 'email', 'opted_out', false, now() - interval '1 hour')`);
    const before = (await q<{ n: string }>(sql`select count(*) as n from communication_event where state in ('queued', 'sent')`))[0]!.n;
    const a = await call(main, 'POST', '/invitations/authorize', { reservationId, refs: [...refs, 'ref_notinthisreservation'] }).expect(200);
    expect(a.body.authorized).toHaveLength(5);
    expect(a.body.refused).toEqual(
      expect.arrayContaining([
        { ref: refs[0], reason: 'opted_out' },
        { ref: 'ref_notinthisreservation', reason: 'not_in_reservation' },
      ]),
    );
    expect(JSON.stringify(a.body)).not.toMatch(/@/);
    // Nothing is sent.
    expect((await q<{ n: string }>(sql`select count(*) as n from communication_event where state in ('queued', 'sent')`))[0]!.n).toBe(before);
    const twice = await call(main, 'POST', '/invitations/authorize', { reservationId, refs }).expect(200);
    expect(twice.body.authorized.map((x: { invitationId: string }) => x.invitationId).sort()).toEqual(
      a.body.authorized.map((x: { invitationId: string }) => x.invitationId).sort(),
    );
    invitations = a.body.authorized.map((x: { invitationId: string }) => x.invitationId);
  });

  it('takes participation events once each, marks clicks, and credits no rewards', async () => {
    const [inv1, inv2] = invitations;
    const ledger = (await q<{ n: string }>(sql`select count(*) as n from reward_ledger`))[0]!.n;
    const now = Date.now();
    const events = [
      { eventId: 'evt-000001', invitationId: inv1, event: 'click', occurredAt: new Date(now - 60_000).toISOString() },
      { eventId: 'evt-000002', invitationId: inv1, event: 'complete', occurredAt: new Date(now).toISOString() },
      { eventId: 'evt-000003', invitationId: inv2, event: 'start', occurredAt: new Date(now).toISOString() },
      { eventId: 'evt-000004', invitationId: '00000000-0000-4000-8000-000000000000', event: 'click', occurredAt: new Date(now).toISOString() },
    ];
    const r = await call(main, 'POST', '/participation/events', { events }).expect(200);
    expect(r.body).toEqual({ accepted: 3, duplicates: 0, unknownInvitations: 1 });
    const again = await call(main, 'POST', '/participation/events', { events: events.slice(0, 2) }).expect(200);
    expect(again.body).toEqual({ accepted: 0, duplicates: 2, unknownInvitations: 0 });
    const rows = await q<{ id: string; status: string; clicked: boolean }>(sql`
      select id, status, clicked_at is not null as clicked from survey_invitation where id in (${inv1!}, ${inv2!})`);
    expect(Object.fromEntries(rows.map((x) => [x.id, [x.status, x.clicked]]))).toEqual({ [inv1!]: ['complete', true], [inv2!]: ['start', true] });
    expect((await q<{ n: string }>(sql`select count(*) as n from reward_ledger`))[0]!.n).toBe(ledger);
    // Another client cannot post events for these invitations.
    const foreign = await call(other, 'POST', '/participation/events', {
      events: [{ eventId: 'evt-x00001', invitationId: inv2, event: 'complete', occurredAt: new Date().toISOString() }],
    }).expect(200);
    expect(foreign.body).toMatchObject({ accepted: 0, unknownInvitations: 1 });
  });

  it('checks consent by ref without saying why beyond the consent state', async () => {
    const r = await call(main, 'POST', '/consent/check', { refs: [...refs, 'ref_unknownunknown12'], purpose: 'survey_invitation' }).expect(200);
    expect(r.body.unknownRefs).toEqual(['ref_unknownunknown12']);
    expect(r.body.results).toHaveLength(6);
    expect(r.body.results.find((x: { ref: string }) => x.ref === refs[0])).toMatchObject({ eligible: false });
    expect(r.body.results.filter((x: { eligible: boolean }) => x.eligible)).toHaveLength(5);
    const mk = await call(main, 'POST', '/consent/check', { refs, purpose: 'email_marketing' }).expect(200);
    // Only members who ticked the marketing opt-in are eligible for it, and the answer says nothing more.
    const stored = await q<{ ref: string; status: string | null }>(sql`
      select sr.ref, cr.status from service_reference sr
      join panel_membership pm on pm.id = sr.panel_membership_id
      left join consent_record cr on cr.master_person_id = pm.master_person_id and cr.panel = pm.panel and cr.purpose = 'email_marketing'
      where sr.ref = any(${`{${refs.join(',')}}`}::text[])`);
    const byRef = new Map(stored.map((x) => [x.ref, x.status ?? 'unknown']));
    for (const x of mk.body.results as { ref: string; consent: string; eligible: boolean }[]) {
      expect(x.consent).toBe(byRef.get(x.ref));
      if (x.consent !== 'granted') expect(x.eligible).toBe(false);
    }
  });

  it('releases a reservation once, which frees its members for other projects', async () => {
    await call(main, 'DELETE', `/reservations/${reservationId}`).expect(200);
    await call(main, 'DELETE', `/reservations/${reservationId}`).expect(409);
    await call(main, 'POST', '/invitations/authorize', { reservationId, refs }).expect(409);
    const free = await call(main, 'POST', '/reservations', { projectRef: 'PRJ-2002', refs: refs.slice(1, 3), expiresAt: expires() }).expect(201);
    expect(free.body.held).toBe(2);
  });

  it('shows each client’s activity to admins as counts only', async () => {
    const list = await request(t.server).get('/api/v1/service-clients').set(as('platform_admin')).expect(200);
    const m = list.body.find((c: { id: string }) => c.id === main.id);
    expect(m.activity).toMatchObject({ activeReservations: 2, membersHeld: 2, invitations: 5, clicked: 2 });
    expect(m.activity.rejectedLast7Days).toBeGreaterThan(0);
  });

  it('reports integration health for the client’s panels only', async () => {
    const all = await call(main, 'GET', '/integrations/health').expect(200);
    expect(all.body.panels.map((p: { panel: string }) => p.panel).sort()).toEqual([...PANELS].sort());
    const one = await call(other, 'GET', '/integrations/health').expect(200);
    expect(one.body.panels.map((p: { panel: string }) => p.panel)).toEqual(['t2o']);
  });
});
