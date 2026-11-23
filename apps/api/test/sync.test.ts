import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PANEL_CODES, type PanelCode, type SourceAnswer, type SourceRespondent } from '@madp/contracts';
import { ConnectorError, type PanelConnector } from '@madp/connectors';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { Database } from '../src/db/database.js';
import { Mongo } from '../src/mongo/mongo.js';
import { SyncScheduler } from '../src/ingestion/sync-scheduler.js';
import { startTestApp } from './helpers.js';

/**
 * Automatic sync from a panel's changed-since feeds, for each of the three panels. The DEMO connector's feeds are
 * replaced by a scripted feed so each run's changes are known exactly: an updated member, a new member, a
 * soft-deleted member, a changed answer, an answer that arrives before its member, a hard delete and an answer
 * reset.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
const bearer = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '120' });
  token = (await t.adminToken('super_admin')).token;
});
afterAll(async () => t?.stop());

type Feed<T> = { pages: T[][]; calls: { cursor: string | null; since?: string | null }[] };
const feed = <T>(pages: T[][] = []): Feed<T> => ({ pages, calls: [] });

/** Feeds that hand out their pages once, in order, with cursor "<n>" after page n. */
function script(c: PanelConnector, m: Feed<SourceRespondent>, a: Feed<SourceAnswer>, d: Feed<never>) {
  const page =
    <T>(f: Feed<T>) =>
    async (q: { cursor: string | null; since?: string | null }) => {
      f.calls.push({ cursor: q.cursor, since: q.since ?? null });
      const at = q.cursor ? Number(q.cursor) : 0;
      const items = f.pages[at] ?? [];
      return { items, cursor: items.length ? String(at + 1) : q.cursor, more: at + 1 < f.pages.length };
    };
  c.memberChanges = page(m);
  c.answerChanges = page(a);
  c.deletions = page(d as Feed<never>);
}

describe.each(PANEL_CODES)('automatic sync [%s]', (panel: PanelCode) => {
  const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    (await t.app.get(Database).db.execute<R>(query)).rows;

  it('reads only what changed, removes deleted members, and parks answers that arrive early', async () => {
    const slot = t.app.get(ConnectorRegistry).get(panel);
    const c = slot.connector;
    const imp = await request(t.server)
      .post(`/api/v1/connectors/${panel}/import`)
      .set(bearer())
      .send({ dryRun: false })
      .expect(200);
    expect(imp.body.status).toBe('succeeded');

    const page = await c.listRespondents(null, 10);
    const [keep, softGone, hardGone, reset] = page.items;
    const allQ = (await c.listQuestions()).map((x) => x.sourceQuestionId);
    const keepAnswers = await c.listAnswers([keep!.sourceMemberId], allQ);
    const hardAnswers = await c.listAnswers([hardGone!.sourceMemberId], allQ);
    expect(keepAnswers.length).toBeGreaterThan(0);
    const changedQ = keepAnswers[0]!;
    const late: SourceRespondent = {
      ...keep!,
      sourceMemberId: `demo-${panel}-late-member`,
      email: `late-${panel}@example.invalid`,
      sourceUpdatedAt: '2026-11-23T12:00:00.000Z',
    };
    const lateAnswer: SourceAnswer = {
      panel,
      sourceMemberId: late.sourceMemberId,
      sourceQuestionId: changedQ.sourceQuestionId,
      values: ['late value'],
      sourceUpdatedAt: '2026-11-23T12:00:01.000Z',
    };
    const members = feed<SourceRespondent>([
      [{ ...keep!, qualityScore: 42 }],
      [{ ...softGone!, isActive: false, isDeleted: true }],
    ]);
    const answers = feed<SourceAnswer>([
      [
        { ...changedQ, values: ['a changed answer'], sourceUpdatedAt: '2026-11-23T12:00:00.000Z' },
        lateAnswer,
      ],
    ]);
    const deletions = feed([
      [
        { panel, sourceMemberId: hardGone!.sourceMemberId, kind: 'member', at: null },
        { panel, sourceMemberId: reset!.sourceMemberId, kind: 'answers', at: null },
        { panel, sourceMemberId: 'never-imported', kind: 'member', at: null },
      ] as never[],
    ]);
    const resetStored = await t.app
      .get(Mongo)
      .profileAnswers.countDocuments({ panel, sourceMemberId: reset!.sourceMemberId });
    expect(resetStored).toBeGreaterThan(0);
    script(c, members, answers, deletions);
    const originalListAnswers = c.listAnswers.bind(c);
    c.listAnswers = async (ids, qs) => {
      if (ids.includes(late.sourceMemberId)) return [lateAnswer];
      return originalListAnswers(ids, qs);
    };

    try {
      const run = await request(t.server).post(`/api/v1/connectors/${panel}/sync`).set(bearer()).expect(200);
      expect(run.body.status).toBe('succeeded');
      expect(run.body.counts).toMatchObject({
        respondentsSeen: 2,
        identitiesCreated: 0,
        identitiesUpdated: 2,
        membersRemoved: 2,
        answerResets: 1,
        deletionsUnknown: 1,
        answersSeen: 2,
        answersParked: 1,
        feedPages: { members: 2, answers: 1, deletions: 1 },
        capped: false,
        questionsRefreshed: false,
      });
      // The first sync starts where the last full import started (minus the overlap), not at the beginning.
      expect(run.body.counts.startedFrom.members).toMatch(/^since /);
      const [{ s: importStart }] = (await q<{ s: Date }>(
        sql`select started_at as s from import_job where id = ${imp.body.jobId}`,
      )) as [{ s: Date }];
      expect(members.calls[0]).toEqual({
        cursor: null,
        since: new Date(new Date(importStart).getTime() - 600_000).toISOString(),
      });
      expect(members.calls[1]).toEqual({ cursor: '1', since: null });

      // Updated member: new value stored.
      const [k] = await q<{ quality_score: number; status: string }>(sql`
        select si.quality_score, pm.status from source_identity si join panel_membership pm on pm.source_identity_id = si.id
        where si.panel = ${panel} and si.source_member_id = ${keep!.sourceMemberId}`);
      expect(k).toEqual({ quality_score: 42, status: 'active' });

      // Removed members: pseudonymous id only, membership deleted, consents withdrawn, answers gone.
      const mongo = t.app.get(Mongo);
      for (const gone of [softGone!, hardGone!]) {
        const [g] = await q<Record<string, unknown>>(sql`
          select si.source_active, si.email_enc, si.email_hash, si.email_masked, si.phone_enc, si.first_name_enc,
                 si.last_name_enc, si.date_of_birth_enc, pm.status, si.master_person_id as person
          from source_identity si join panel_membership pm on pm.source_identity_id = si.id
          where si.panel = ${panel} and si.source_member_id = ${gone.sourceMemberId}`);
        expect(g).toMatchObject({
          source_active: false,
          email_enc: null,
          email_hash: null,
          email_masked: null,
          phone_enc: null,
          first_name_enc: null,
          last_name_enc: null,
          date_of_birth_enc: null,
          status: 'deleted',
        });
        const consents = await q<{ status: string }>(
          sql`select status from consent_record where panel = ${panel} and master_person_id = ${g!.person as string}`,
        );
        expect(consents.every((x) => x.status === 'withdrawn')).toBe(true);
        expect(
          await mongo.profileAnswers.countDocuments({ panel, sourceMemberId: gone.sourceMemberId }),
        ).toBe(0);
        expect(await mongo.answerHistory.countDocuments({ panel, sourceMemberId: gone.sourceMemberId })).toBe(
          0,
        );
      }
      expect(hardAnswers.length).toBeGreaterThan(0);

      // Changed answer stored, old value kept in history.
      const cur = await mongo.profileAnswers.findOne({
        panel,
        sourceMemberId: keep!.sourceMemberId,
        sourceQuestionId: changedQ.sourceQuestionId,
      });
      expect(cur?.values).toEqual(['a changed answer']);
      expect(
        await mongo.answerHistory.countDocuments({
          panel,
          sourceMemberId: keep!.sourceMemberId,
          sourceQuestionId: changedQ.sourceQuestionId,
        }),
      ).toBe(1);

      // Answer reset: current answers moved to history.
      expect(
        await mongo.profileAnswers.countDocuments({ panel, sourceMemberId: reset!.sourceMemberId }),
      ).toBe(0);
      expect(await mongo.answerHistory.countDocuments({ panel, sourceMemberId: reset!.sourceMemberId })).toBe(
        resetStored,
      );

      // Checkpoints saved per feed.
      const cps = await q<{ stream: string; cursor: string | null }>(
        sql`select stream, cursor from sync_checkpoint where panel = ${panel} and stream like 'changes.%' order by stream`,
      );
      expect(cps).toEqual([
        { stream: 'changes.answers', cursor: '1' },
        { stream: 'changes.deletions', cursor: '1' },
        { stream: 'changes.members', cursor: '2' },
      ]);

      // Audiences leave the removed members out.
      const audience = await q<{ n: string }>(sql`
        select count(*) as n from panel_membership where panel = ${panel} and status = 'active'
        and source_identity_id in (select id from source_identity where source_member_id in (${softGone!.sourceMemberId}, ${hardGone!.sourceMemberId}))`);
      expect(Number(audience[0]!.n)).toBe(0);

      // The directory finds them by membership status.
      const removed = await request(t.server)
        .get(`/api/v1/panellists?panel=${panel}&membership=deleted`)
        .set(bearer())
        .expect(200);
      expect(removed.body.items).toHaveLength(2);
      for (const r of removed.body.items) expect(r.memberships).toContainEqual({ panel, status: 'deleted' });

      const status1 = await request(t.server).get('/api/v1/sync-status').set(bearer()).expect(200);
      const mine = status1.body.panels.find((p: { panel: string }) => p.panel === panel);
      expect(mine).toMatchObject({ dataMode: 'demo', scheduled: false, parkedAnswerBatches: 1 });
      expect(mine.lastRun.status).toBe('succeeded');

      // Next run: the late member arrives; its parked answers are read and stored. Nothing else is re-read.
      members.pages.push([late]);
      const run2 = await request(t.server).post(`/api/v1/connectors/${panel}/sync`).set(bearer()).expect(200);
      expect(run2.body.counts).toMatchObject({
        respondentsSeen: 1,
        identitiesCreated: 1,
        parkedResolved: 1,
        answersSeen: 0,
        membersRemoved: 0,
      });
      expect(members.calls.at(-1)).toEqual({ cursor: '2', since: null });
      expect(answers.calls.at(-1)).toEqual({ cursor: '1', since: null });
      const lateStored = await mongo.profileAnswers.findOne({ panel, sourceMemberId: late.sourceMemberId });
      expect(lateStored?.values).toEqual(['late value']);

      // A run with nothing new changes nothing.
      const run3 = await request(t.server).post(`/api/v1/connectors/${panel}/sync`).set(bearer()).expect(200);
      expect(run3.body.counts).toMatchObject({
        respondentsSeen: 0,
        answersSeen: 0,
        answersChanged: 0,
        membersRemoved: 0,
        parkedResolved: 0,
      });
      const status2 = await request(t.server).get('/api/v1/sync-status').set(bearer()).expect(200);
      expect(status2.body.panels.find((p: { panel: string }) => p.panel === panel).parkedAnswerBatches).toBe(
        0,
      );
    } finally {
      c.listAnswers = originalListAnswers;
    }
  }, 120_000);

  it('reports a panel without the changes feed as not supported, without failing', async () => {
    const c = t.app.get(ConnectorRegistry).get(panel).connector;
    const saved = c.memberChanges;
    c.memberChanges = async () => {
      throw new ConnectorError(
        `${panel} does not serve /api/v1/changes/members yet (404)`,
        panel,
        'not_supported',
        404,
      );
    };
    try {
      const run = await request(t.server).post(`/api/v1/connectors/${panel}/sync`).set(bearer()).expect(200);
      expect(run.body.status).toBe('not_supported');
      const [job] = await (
        await t.app
          .get(Database)
          .db.execute<{ status: string; kind: string }>(
            sql`select status, kind from import_job where id = ${run.body.jobId}`,
          )
      ).rows;
      expect(job).toEqual({ status: 'cancelled', kind: 'sync' });
    } finally {
      c.memberChanges = saved;
    }
  });
});

describe('sync permissions and scheduling', () => {
  it('only operators can start a sync; data stewards can only read its status', async () => {
    const viewer = await t.adminToken('data_steward', 'sync-steward@example.invalid');
    await request(t.server)
      .post('/api/v1/connectors/t2o/sync')
      .set({ authorization: `Bearer ${viewer.token}` })
      .expect(403);
    await request(t.server)
      .get('/api/v1/sync-status')
      .set({ authorization: `Bearer ${viewer.token}` })
      .expect(200);
  });

  it('lists teens by guardian consent', async () => {
    const teens = await request(t.server)
      .get('/api/v1/panellists?panel=t2o&minor=true&limit=100')
      .set(bearer())
      .expect(200);
    expect(teens.body.items.length).toBeGreaterThan(0);
    expect(teens.body.items.every((p: { minor: boolean }) => p.minor)).toBe(true);
    for (const g of ['granted', 'unknown'] as const) {
      const r = await request(t.server)
        .get(`/api/v1/panellists?panel=t2o&guardian=${g}&limit=100`)
        .set(bearer())
        .expect(200);
      expect(r.body.items.every((p: { guardianConsent: string }) => p.guardianConsent === g)).toBe(true);
    }
    await request(t.server).get('/api/v1/panellists?guardian=maybe').set(bearer()).expect(400);
  });

  it('schedules nothing while every panel runs on DEMO data', async () => {
    const s = t.app.get(SyncScheduler);
    expect(s.panels()).toEqual([]);
    await s.tick();
  });
});
