import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { PanelCode, SourceAnswer, SourceRespondent } from '@madp/contracts';
import type { PanelConnector } from '@madp/connectors';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { Database } from '../src/db/database.js';
import { Mongo } from '../src/mongo/mongo.js';
import { startTestApp } from './helpers.js';

/**
 * Cross-panel identity review on DEMO data: a T2O and an MFR account with the same e-mail become a match
 * candidate, a reviewer merges them, and the merge is then undone. Also: reject, automatic links and their unmerge,
 * source precedence for person fields, permissions and the append-only link history.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
let analyst: string;
const bearer = (tk = token) => ({ authorization: `Bearer ${tk}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '30' });
  token = (await t.adminToken('super_admin')).token;
  analyst = (await t.adminToken('analyst')).token;
});
afterAll(async () => t?.stop());

/** Replaces a panel's feeds with one page of members and answers, and no deletions. */
let feedRun = 0;
function feedOnce(c: PanelConnector, members: SourceRespondent[], answers: SourceAnswer[]) {
  const done = `run-${++feedRun}`;
  const once =
    <T>(items: T[]) =>
    async (p: { cursor: string | null }) =>
      p.cursor === done ? { items: [], cursor: done, more: false } : { items, cursor: done, more: false };
  c.memberChanges = once(members);
  c.answerChanges = once(answers);
  c.deletions = once([]);
}

async function addMember(
  panel: PanelCode,
  id: string,
  over: Partial<SourceRespondent>,
): Promise<{ member: SourceRespondent; question: string }> {
  const c = t.app.get(ConnectorRegistry).get(panel).connector;
  const [base] = (await c.listRespondents(null, 1)).items;
  const question = (await c.listQuestions())[0]!.sourceQuestionId;
  const member: SourceRespondent = {
    ...base!,
    sourceMemberId: id,
    sourceRespondentRef: null,
    isDeleted: false,
    isStaff: false,
    isActive: true,
    ...over,
  };
  feedOnce(c, [member], [{ panel, sourceMemberId: id, sourceQuestionId: question, values: ['x'], sourceUpdatedAt: null }]);
  const run = await request(t.server).post(`/api/v1/connectors/${panel}/sync`).set(bearer()).expect(200);
  expect(run.body.status).toBe('succeeded');
  return { member, question };
}

const identityOf = async (panel: PanelCode, id: string) =>
  (
    await q<{ id: string; person: string }>(
      sql`select id, master_person_id as person from source_identity where panel = ${panel} and source_member_id = ${id}`,
    )
  )[0]!;

describe('cross-panel identity review', () => {
  it('imports the panels first', async () => {
    for (const panel of ['t2o', 'mfr', 'mho'] as const)
      await request(t.server)
        .post(`/api/v1/connectors/${panel}/import`)
        .set(bearer())
        .send({ dryRun: false })
        .expect(200);
  });

  it('merges a reviewed match, then unmerges it back to the same person', async () => {
    const email = 'demo-shared-1@example.invalid';
    await addMember('t2o', 'demo-t2o-shared-1', {
      email,
      emailVerification: 'verified',
      sourceCategory: 'b2c',
      country: 'in',
      city: 'pune',
      state: null,
      gender: 'Female',
      dateOfBirth: null,
      sourceUpdatedAt: '2026-11-01T00:00:00.000Z',
    });
    await addMember('mfr', 'demo-mfr-shared-1', {
      email,
      emailVerification: 'unverified',
      sourceCategory: 'b2b',
      country: 'in',
      city: 'mumbai',
      state: null,
      gender: null,
      dateOfBirth: '1990-04-04',
      sourceUpdatedAt: '2026-11-20T00:00:00.000Z',
    });
    const a = await identityOf('t2o', 'demo-t2o-shared-1');
    const b = await identityOf('mfr', 'demo-mfr-shared-1');
    expect(a.person).not.toBe(b.person);

    // Permissions: an analyst cannot see or decide matches.
    await request(t.server).get('/api/v1/identity/candidates').set(bearer(analyst)).expect(403);

    const list = await request(t.server).get('/api/v1/identity/candidates?panel=mfr').set(bearer()).expect(200);
    const item = list.body.items.find((i: { identity: { id: string } }) => i.identity.id === b.id);
    expect(item).toMatchObject({
      rule: 'exact_email_keyed_hash',
      status: 'pending',
      linked: false,
      identity: { panel: 'mfr', personId: b.person, emailVerification: 'unverified' },
      candidate: { personId: a.person },
    });
    expect(item.identity.emailMasked).not.toContain('demo-shared-1@');
    expect(item.candidate.identities.map((i: { panel: string }) => i.panel)).toEqual(['t2o']);
    await request(t.server)
      .post(`/api/v1/identity/candidates/${item.id}/decision`)
      .set(bearer(analyst))
      .send({ decision: 'approve' })
      .expect(403);

    const mongo = t.app.get(Mongo);
    const answersB = await mongo.profileAnswers.countDocuments({ panel: 'mfr', sourceMemberId: 'demo-mfr-shared-1' });
    expect(answersB).toBeGreaterThan(0);
    const counts = async () =>
      (await request(t.server).post('/api/v1/audience/counts').set(bearer()).send({}).expect(200)).body;
    const before = await counts();

    // Merge.
    const merged = await request(t.server)
      .post(`/api/v1/identity/candidates/${item.id}/decision`)
      .set(bearer())
      .send({ decision: 'approve', reason: 'same e-mail, same city' })
      .expect(201);
    expect(merged.body).toMatchObject({
      status: 'approved',
      personId: a.person,
      fromPersonId: b.person,
      answersMoved: answersB,
    });
    expect((await identityOf('mfr', 'demo-mfr-shared-1')).person).toBe(a.person);
    const people = await q<{ id: string; status: string; city: string | null; gender: string | null; birth_year: number | null; field_sources: Record<string, { panel: string }> }>(
      sql`select id, status, city, gender, birth_year, field_sources from master_person where id in (${a.person}, ${b.person})`,
    );
    const pa = people.find((p) => p.id === a.person)!;
    const pb = people.find((p) => p.id === b.person)!;
    // Precedence: the verified T2O account owns city and gender; only MFR has a birth year.
    expect(pa).toMatchObject({ status: 'active', city: 'pune', gender: 'Female', birth_year: 1990 });
    expect(pa.field_sources.city!.panel).toBe('t2o');
    expect(pa.field_sources.birthYear!.panel).toBe('mfr');
    expect(pb.status).toBe('merged');
    const cats = await q<{ category: string; panel: string }>(
      sql`select category::text, panel::text from category_membership where master_person_id = ${a.person} order by panel`,
    );
    expect(cats).toEqual([
      { category: 'business_professional', panel: 'mfr' },
      { category: 'consumer', panel: 't2o' },
    ]);
    const consentPanels = await q<{ panel: string }>(
      sql`select distinct panel::text from consent_record where master_person_id = ${a.person} order by 1`,
    );
    expect(consentPanels.map((r) => r.panel)).toEqual(['mfr', 't2o']);
    expect(
      await mongo.profileAnswers.countDocuments({ panel: 'mfr', sourceMemberId: 'demo-mfr-shared-1', personId: a.person }),
    ).toBe(answersB);
    // One fewer unique person, same number of memberships.
    const after = await counts();
    expect(after.uniquePeople).toBe(before.uniquePeople - 1);
    expect(after.panelMemberships).toBe(before.panelMemberships);
    // The emptied person is gone from the directory.
    const dir = await request(t.server)
      .get('/api/v1/panellists?search=demo-mfr-shared-1')
      .set(bearer())
      .expect(200);
    expect(dir.body.items.map((i: { id: string }) => i.id)).toEqual([a.person]);

    await request(t.server)
      .post(`/api/v1/identity/candidates/${item.id}/decision`)
      .set(bearer())
      .send({ decision: 'approve' })
      .expect(409);

    // Unmerge: a reason is required, and the MFR account returns to its own, original person.
    await request(t.server).post(`/api/v1/identity/source-identities/${b.id}/unlink`).set(bearer()).send({}).expect(400);
    const un = await request(t.server)
      .post(`/api/v1/identity/source-identities/${b.id}/unlink`)
      .set(bearer())
      .send({ reason: 'different people: the panel confirmed two households' })
      .expect(201);
    expect(un.body).toMatchObject({ personId: b.person, fromPersonId: a.person, answersMoved: answersB });
    const back = await q<{ id: string; status: string; city: string | null; birth_year: number | null }>(
      sql`select id, status, city, birth_year from master_person where id in (${a.person}, ${b.person}) order by id`,
    );
    expect(back.find((p) => p.id === b.person)).toMatchObject({ status: 'active', city: 'mumbai', birth_year: 1990 });
    expect(back.find((p) => p.id === a.person)).toMatchObject({ city: 'pune', birth_year: null });
    expect(
      await q(sql`select 1 from category_membership where master_person_id = ${a.person} and panel = 'mfr'`),
    ).toHaveLength(0);
    expect(
      await mongo.profileAnswers.countDocuments({ panel: 'mfr', sourceMemberId: 'demo-mfr-shared-1', personId: b.person }),
    ).toBe(answersB);
    expect((await counts()).uniquePeople).toBe(before.uniquePeople);
    const cand = await q<{ status: string }>(sql`select status::text from identity_match_candidate where id = ${item.id}`);
    expect(cand[0]!.status).toBe('rejected');

    // History: one merge, one unmerge, with reasons; the record cannot be edited.
    const hist = await request(t.server).get(`/api/v1/identity/persons/${a.person}/history`).set(bearer()).expect(200);
    expect(hist.body.items.map((e: { action: string; reason: string }) => [e.action, e.reason])).toEqual([
      ['merge', 'same e-mail, same city'],
      ['unmerge', 'different people: the panel confirmed two households'],
    ]);
    const edit = await q(sql`update identity_link_event set reason = 'edited'`).catch((e: { cause?: Error }) => e);
    expect(String((edit as { cause?: Error }).cause?.message)).toMatch(/append-only/);
    const audit = await q<{ action: string }>(
      sql`select action from audit_event where action in ('identity.merged', 'identity.unmerged') order by at`,
    );
    expect(audit.map((r) => r.action)).toEqual(['identity.merged', 'identity.unmerged']);

    // The T2O account is now alone again: nothing to unmerge.
    await request(t.server)
      .post(`/api/v1/identity/source-identities/${a.id}/unlink`)
      .set(bearer())
      .send({ reason: 'try' })
      .expect(409);

    // A later sync keeps the unmerge: the account stays with its own person.
    await addMember('mfr', 'demo-mfr-shared-1', {
      email,
      emailVerification: 'unverified',
      sourceCategory: 'b2b',
      city: 'mumbai',
      qualityScore: 7,
    });
    expect((await identityOf('mfr', 'demo-mfr-shared-1')).person).toBe(b.person);
  });

  it('rejects a match and leaves both people as they are', async () => {
    const email = 'demo-shared-2@example.invalid';
    await addMember('t2o', 'demo-t2o-shared-2', { email, emailVerification: 'verified' });
    await addMember('mho', 'demo-mho-shared-2', { email, emailVerification: 'unverified', sourceCategory: 'patient' });
    const a = await identityOf('t2o', 'demo-t2o-shared-2');
    const b = await identityOf('mho', 'demo-mho-shared-2');
    const [c] = await q<{ id: string }>(
      sql`select id from identity_match_candidate where source_identity_id = ${b.id} and status = 'pending'`,
    );
    const r = await request(t.server)
      .post(`/api/v1/identity/candidates/${c!.id}/decision`)
      .set(bearer())
      .send({ decision: 'reject', reason: 'shared family inbox' })
      .expect(201);
    expect(r.body.status).toBe('rejected');
    expect((await identityOf('mho', 'demo-mho-shared-2')).person).toBe(b.person);
    expect(b.person).not.toBe(a.person);
    const rejected = await request(t.server).get('/api/v1/identity/candidates?status=rejected').set(bearer()).expect(200);
    expect(rejected.body.items.some((i: { id: string }) => i.id === c!.id)).toBe(true);
  });

  it('refuses to merge into a person that already has a membership on the same panel', async () => {
    // Two MFR accounts and one T2O account share an e-mail. Both MFR accounts are candidates for the T2O person:
    // the first merge succeeds, the second would give that person two MFR memberships and is refused.
    const email = 'demo-shared-3@example.invalid';
    await addMember('t2o', 'demo-t2o-shared-3', { email, emailVerification: 'verified' });
    await addMember('mfr', 'demo-mfr-shared-3a', { email, emailVerification: 'unverified' });
    await addMember('mfr', 'demo-mfr-shared-3b', { email, emailVerification: 'unverified' });
    const ids = await q<{ id: string; panel: string }>(sql`
      select c.id, si.panel::text from identity_match_candidate c join source_identity si on si.id = c.source_identity_id
      where si.source_member_id in ('demo-mfr-shared-3a', 'demo-mfr-shared-3b') and c.status = 'pending' order by si.source_member_id`);
    expect(ids).toHaveLength(2);
    await request(t.server)
      .post(`/api/v1/identity/candidates/${ids[0]!.id}/decision`)
      .set(bearer())
      .send({ decision: 'approve' })
      .expect(201);
    const second = await request(t.server)
      .post(`/api/v1/identity/candidates/${ids[1]!.id}/decision`)
      .set(bearer())
      .send({ decision: 'approve' })
      .expect(409);
    expect(second.body.message).toMatch(/already has a MFR membership/);
    const [still] = await q<{ status: string }>(sql`select status::text from identity_match_candidate where id = ${ids[1]!.id}`);
    expect(still!.status).toBe('pending');
  });

  it('undoes an automatic link between two verified accounts', async () => {
    const email = 'demo-shared-4@example.invalid';
    await addMember('mfr', 'demo-mfr-shared-4', { email, emailVerification: 'verified' });
    await addMember('mho', 'demo-mho-shared-4', { email, emailVerification: 'verified', sourceCategory: 'care giver' });
    const a = await identityOf('mfr', 'demo-mfr-shared-4');
    const b = await identityOf('mho', 'demo-mho-shared-4');
    expect(b.person).toBe(a.person);
    const [auto] = await q<{ status: string }>(
      sql`select status::text from identity_match_candidate where source_identity_id = ${b.id}`,
    );
    expect(auto!.status).toBe('approved');
    const un = await request(t.server)
      .post(`/api/v1/identity/source-identities/${b.id}/unlink`)
      .set(bearer())
      .send({ reason: 'caregiver and patient are different people' })
      .expect(201);
    // There was no earlier person to go back to, so the MHO account gets a new one.
    expect(un.body.fromPersonId).toBe(a.person);
    expect(un.body.personId).not.toBe(a.person);
    const cats = await q<{ category: string }>(
      sql`select category::text from category_membership where master_person_id = ${un.body.personId}`,
    );
    expect(cats.map((c) => c.category)).toEqual(['caregiver']);
  });
});
