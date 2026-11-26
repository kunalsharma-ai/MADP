import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { SourceAnswer, SourceConsent, SourceRespondent } from '@madp/contracts';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { Database } from '../src/db/database.js';
import { sensitivityFor } from '../src/ingestion/canonical.js';
import { startTestApp } from './helpers.js';

/**
 * Stricter controls for MHO health data on DEMO data: a stated purpose before health answers are shown, a minor's
 * health answers locked until the guardian's consent is granted, and a larger minimum cell for health filters.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
let superToken: string;
let steward: string;
const as = (tk: string) => ({ authorization: `Bearer ${tk}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '40' });
  superToken = (await t.adminToken('super_admin')).token;
  steward = (await t.adminToken('data_steward')).token;
  await request(t.server)
    .post('/api/v1/connectors/mho/import')
    .set(as(superToken))
    .send({ dryRun: false })
    .expect(200);
});
afterAll(async () => t?.stop());

let feedRun = 0;
async function syncMho(member: SourceRespondent, answers: SourceAnswer[]) {
  const c = t.app.get(ConnectorRegistry).get('mho').connector;
  const done = `mho-run-${++feedRun}`;
  const once =
    <T>(items: T[]) =>
    async (p: { cursor: string | null }) =>
      p.cursor === done ? { items: [], cursor: done, more: false } : { items, cursor: done, more: false };
  c.memberChanges = once([member]);
  c.answerChanges = once(answers);
  c.deletions = once([]);
  const r = await request(t.server).post('/api/v1/connectors/mho/sync').set(as(superToken)).expect(200);
  expect(r.body.status).toBe('succeeded');
}

const personOf = async (memberId: string) =>
  (
    await q<{ person: string }>(
      sql`select master_person_id as person from source_identity where panel = 'mho' and source_member_id = ${memberId}`,
    )
  )[0]!.person;

describe('purpose-limited access to health answers', () => {
  it('asks for a purpose before showing health answers, and audits it', async () => {
    const [row] = await q<{ person: string }>(sql`
      select pm.master_person_id as person from panel_membership pm
      where pm.panel = 'mho' and not exists (
        select 1 from category_membership c where c.master_person_id = pm.master_person_id and c.is_minor)
      limit 50`);
    // Find an adult MHO member who has at least one health answer.
    const candidates = await q<{ person: string }>(sql`
      select pm.master_person_id as person from panel_membership pm
      where pm.panel = 'mho' and not exists (
        select 1 from category_membership c where c.master_person_id = pm.master_person_id and c.is_minor)`);
    let id = row!.person;
    for (const c of candidates) {
      const d = await request(t.server).get(`/api/v1/panellists/${c.person}`).set(as(superToken)).expect(200);
      if (d.body.hiddenSensitiveAnswers > 0) {
        id = c.person;
        break;
      }
    }
    const without = await request(t.server).get(`/api/v1/panellists/${id}`).set(as(superToken)).expect(200);
    expect(without.body.access).toMatchObject({ healthSensitive: false, healthPurposeRequired: true, purpose: null });
    expect(without.body.hiddenSensitiveAnswers).toBeGreaterThan(0);
    expect(without.body.answers.some((a: { sensitivity: string }) => a.sensitivity === 'special_category')).toBe(false);

    await request(t.server).get(`/api/v1/panellists/${id}?purpose=curiosity`).set(as(superToken)).expect(400);

    const withPurpose = await request(t.server)
      .get(`/api/v1/panellists/${id}?purpose=participant_support`)
      .set(as(superToken))
      .expect(200);
    expect(withPurpose.body.access).toMatchObject({ healthSensitive: true, healthPurposeRequired: false });
    expect(withPurpose.body.hiddenSensitiveAnswers).toBe(0);
    expect(withPurpose.body.answers.some((a: { sensitivity: string }) => a.sensitivity === 'special_category')).toBe(
      true,
    );
    const [audit] = await q<{ purpose: string | null }>(sql`
      select metadata->>'purpose' as purpose from audit_event
      where action = 'panellist.viewed' and target_id = ${id} order by at desc limit 1`);
    expect(audit!.purpose).toBe('participant_support');

    // A purpose does not open health answers for someone without health.sensitive.read.
    const s = await request(t.server)
      .get(`/api/v1/panellists/${id}?purpose=participant_support`)
      .set(as(steward))
      .expect(200);
    expect(s.body.access).toMatchObject({ healthSensitive: false, healthPurposeRequired: false });
    expect(s.body.answers.some((a: { sensitivity: string }) => a.sensitivity === 'special_category')).toBe(false);
  });

  it("keeps a minor's health answers locked until the guardian consents", async () => {
    const c = t.app.get(ConnectorRegistry).get('mho').connector;
    const [base] = (await c.listRespondents(null, 1)).items;
    const question = (await c.listQuestions()).find(
      (x) => sensitivityFor('mho', x.sourceQuestionId, x.categories) === 'special_category',
    )!.sourceQuestionId;
    const guardian = (status: SourceConsent['status']): SourceConsent => ({
      purpose: 'guardian_consent',
      status,
      capturedAt: null,
      evidence: { field: 'parent.consentStatus', value: status === 'granted' ? 'approved' : 'pending', version: null },
    });
    const teen: SourceRespondent = {
      ...base!,
      sourceMemberId: 'demo-mho-teen-health',
      sourceRespondentRef: null,
      email: 'demo-mho-teen-health@example.invalid',
      sourceCategory: 'minor patient',
      isActive: true,
      isDeleted: false,
      isStaff: false,
      consents: [guardian('unknown')],
    };
    const answer: SourceAnswer = {
      panel: 'mho',
      sourceMemberId: teen.sourceMemberId,
      sourceQuestionId: question,
      values: ['yes'],
      sourceUpdatedAt: null,
    };
    await syncMho(teen, [answer]);
    const id = await personOf(teen.sourceMemberId);
    const locked = await request(t.server)
      .get(`/api/v1/panellists/${id}?purpose=participant_support`)
      .set(as(superToken))
      .expect(200);
    // A minor patient is in Patients and, since 26 Nov 2026, in Teens too.
    expect(locked.body.categories).toEqual([
      expect.objectContaining({ category: 'patient', isMinor: true }),
      expect.objectContaining({ category: 'teen', isMinor: true }),
    ]);
    expect(locked.body.hiddenMinorAnswers).toBe(1);
    expect(locked.body.hiddenSensitiveAnswers).toBe(1);
    expect(locked.body.answers.some((a: { sourceQuestionId: string }) => a.sourceQuestionId === question)).toBe(false);

    await syncMho({ ...teen, consents: [guardian('granted')] }, []);
    const open = await request(t.server)
      .get(`/api/v1/panellists/${id}?purpose=participant_support`)
      .set(as(superToken))
      .expect(200);
    expect(open.body.hiddenMinorAnswers).toBe(0);
    expect(open.body.answers.some((a: { sourceQuestionId: string }) => a.sourceQuestionId === question)).toBe(true);
  });
});
