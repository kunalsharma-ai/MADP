import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { startTestApp } from './helpers.js';
import { Database } from '../src/db/database.js';
import { Mongo } from '../src/mongo/mongo.js';
import { sensitivityFor } from '../src/ingestion/canonical.js';

/**
 * Contract test against a running copy of the real T2O backend (Project/backend from the T2O repo), which MFR and
 * MHO also run in production as separate tenants (by Host). The panel's question bank is loaded and test members are
 * created through the panel's own sign-up, guardian and activation flows. It never talks to production. Opt in with:
 *
 *   T2O_LOCAL_PANEL=t2o|mfr|mho (default t2o) T2O_LOCAL_BASE_URL=http://<panel>.localhost \
 *   T2O_LOCAL_TOKEN=<admin token from that copy> T2O_LOCAL_EXPECT=<path to expect.json> \
 *   pnpm --filter @madp/api test:integration -- t2o-local
 *
 * `expect.json` lists the accounts that were created ({ label, memberId, sourceCategory, canonical, minor, guardian, answers }).
 * The import runs in a throw-away database that is dropped afterwards.
 */
const PANEL = (process.env.T2O_LOCAL_PANEL ?? 't2o') as 't2o' | 'mfr' | 'mho';
const P = PANEL.toUpperCase();
const BASE = process.env.T2O_LOCAL_BASE_URL;
const TOKEN = process.env.T2O_LOCAL_TOKEN;
const EXPECT = process.env.T2O_LOCAL_EXPECT;
const REPORT = process.env.T2O_LOCAL_REPORT;
// The connector is deliberately polite (one request per 250 ms), and the bank has 848 option lists.
const SLOW = 15 * 60_000;
// Optional, for the automatic-sync part: the harness tokens.json, and two disposable member ids on the local copy
// (one is deleted, one has its answers reset). Never point these at a real panel.
const TOKENS = process.env.T2O_LOCAL_TOKENS;
const DISPOSABLE = (process.env.T2O_LOCAL_DISPOSABLE ?? '').split(',').filter(Boolean);

interface Expected {
  label: string;
  memberId: string;
  sourceCategory: string;
  canonical: string | null;
  minor: boolean;
  guardian: 'granted' | 'unknown' | null;
  answers: number;
}

/** The bank seed-bank.mjs loads: the panel's fixture, one questionnaire per name and category. */
function bankSize() {
  const f = JSON.parse(
    fs.readFileSync(
      new URL(`../../../packages/testing/src/fixtures/${PANEL}.source-sample.json`, import.meta.url),
      'utf8',
    ),
  ) as {
    profiles: { name: string; sourceCategory: string }[];
    questions: { name: string; category?: string | string[] }[];
  };
  const names = new Set(f.profiles.map((p) => `${p.name}\u0000${p.sourceCategory}`));
  const categories = new Map(f.questions.map((q) => [q.name, ([] as string[]).concat(q.category ?? [])]));
  return { questionnaires: names.size, questions: f.questions.length, categories };
}

describe.skipIf(!BASE || !TOKEN || !EXPECT)(`${P} on the local panel backend, end to end`, () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let token: string;
  const bearer = () => ({ authorization: `Bearer ${token}` });
  const expected: Expected[] = EXPECT ? JSON.parse(fs.readFileSync(EXPECT, 'utf8')) : [];
  const report: Record<string, unknown> = {};

  beforeAll(async () => {
    t = await startTestApp({
      LIVE_SOURCE_APPROVED_PANELS: PANEL,
      [`${P}_API_BASE_URL`]: BASE!,
      [`${P}_API_TOKEN`]: TOKEN!,
    });
    token = (await t.adminToken('super_admin')).token;
  });
  afterAll(async () => {
    if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await t?.stop();
  });

  it(
    'dry run reads the whole bank and every member, and writes nothing',
    async () => {
      const dry = await request(t.server)
        .post(`/api/v1/connectors/${PANEL}/import`)
        .set(bearer())
        .send({ dryRun: true })
        .expect(200);
      report.dryRun = { status: dry.body.status, error: dry.body.error, counts: dry.body.counts };
      expect(dry.body.status).toBe('succeeded');
      expect(dry.body.counts.questionnaires).toBe(bankSize().questionnaires);
      expect(dry.body.counts.questions).toBe(bankSize().questions);
      // The local copy may also hold accounts made by hand through the UI; every listed one must be there.
      expect(dry.body.counts.respondentsSeen).toBeGreaterThanOrEqual(expected.length);
      const db = t.app.get(Database).db;
      const n = await db.execute<{ n: string }>(sql`select count(*) as n from source_identity`);
      expect(Number(n.rows[0]!.n)).toBe(0);
    },
    SLOW,
  );

  it(
    'imports members, categories, consent and answers as the panel recorded them',
    async () => {
      const run = await request(t.server)
        .post(`/api/v1/connectors/${PANEL}/import`)
        .set(bearer())
        .send({ dryRun: false })
        .expect(200);
      report.import = { status: run.body.status, error: run.body.error, counts: run.body.counts };
      expect(run.body.status).toBe('succeeded');

      const db = t.app.get(Database).db;
      const mongo = t.app.get(Mongo);
      const rows = await db.execute<{
        email_masked: string;
        source_category: string;
        category: string | null;
        is_minor: boolean | null;
        person: string;
        member: string;
      }>(sql`
      select si.email_masked, si.source_category, cm.category::text as category, cm.is_minor,
             si.master_person_id as person, si.source_member_id as member
      from source_identity si left join category_membership cm on cm.master_person_id = si.master_person_id`);
      const members = [];
      for (const e of expected) {
        const row = rows.rows.find((r) => r.member === e.memberId);
        expect(row, `imported ${e.label}`).toBeDefined();
        expect(row!.source_category).toBe(e.sourceCategory);
        expect(Boolean(row!.is_minor)).toBe(e.minor);
        expect(row!.category).toBe(e.canonical);
        const consents = await db.execute<{
          purpose: string;
          status: string;
          evidence: Record<string, unknown>;
        }>(sql`select purpose, status, evidence from consent_record where master_person_id = ${row!.person}`);
        const guardian = consents.rows.find((c) => c.purpose === 'guardian_consent');
        expect(guardian?.status ?? null).toBe(e.guardian);
        expect(JSON.stringify(consents.rows)).not.toMatch(/guardian\d?@|consentIP|\d+\.\d+\.\d+\.\d+/);
        const answers = await mongo.profileAnswers.countDocuments({ personId: row!.person });
        expect(answers).toBeGreaterThanOrEqual(e.answers);
        members.push({
          account: e.label,
          sourceCategory: e.sourceCategory,
          madpCategory: e.canonical + (row!.is_minor ? ' (minor)' : ''),
          consents: Object.fromEntries(consents.rows.map((c) => [c.purpose, c.status])),
          answers,
        });
      }
      report.members = members;
      // The admin integration account is panel staff, not a member.
      if (TOKENS) {
        const staff = (JSON.parse(fs.readFileSync(TOKENS, 'utf8')) as Record<string, { userID?: string }>)
          .integration;
        if (staff?.userID) {
          expect(rows.rows.some((r) => r.member === staff.userID)).toBe(false);
          expect(run.body.counts.staffSkipped).toBeGreaterThanOrEqual(1);
        }
      }
      // MHO: every answer is special-category unless its question is on the demographic allow-list or asked of
      // healthcare professionals only.
      if (PANEL === 'mho') {
        const all = await mongo.profileAnswers.find({ panel: 'mho' }).toArray();
        expect(all.length).toBeGreaterThan(0);
        for (const a of all)
          expect(a.sensitivity, a.sourceQuestionId).toBe(
            sensitivityFor('mho', a.sourceQuestionId, bankSize().categories.get(a.sourceQuestionId) ?? []),
          );
        expect(all.some((a) => a.sensitivity === 'special_category')).toBe(true);
      }
      expect(
        await mongo.profileAnswers.countDocuments({
          sourceQuestionId: { $in: ['mail', 'phone', 'firstname', 'dob'] },
        }),
      ).toBe(0);

      const rec = await request(t.server)
        .get(`/api/v1/imports/${run.body.jobId}/reconciliation`)
        .set(bearer())
        .expect(200);
      report.reconciliation = { status: rec.body.status, checks: rec.body.checks };
      expect(rec.body.status).toBe('reconciled');
    },
    SLOW,
  );

  it(
    're-import is idempotent',
    async () => {
      const db = t.app.get(Database).db;
      const count = async (table: string) =>
        Number((await db.execute<{ n: string }>(sql.raw(`select count(*) as n from ${table}`))).rows[0]!.n);
      const before = [
        await count('source_identity'),
        await count('consent_record'),
        await count('master_person'),
      ];
      const run = await request(t.server)
        .post(`/api/v1/connectors/${PANEL}/import`)
        .set(bearer())
        .send({ dryRun: false })
        .expect(200);
      expect(run.body.status).toBe('succeeded');
      expect([
        await count('source_identity'),
        await count('consent_record'),
        await count('master_person'),
      ]).toEqual(before);
      report.reimport = { counts: run.body.counts, unchanged: true };
    },
    SLOW,
  );

  it.skipIf(!TOKENS || DISPOSABLE.length !== 2)(
    'automatic sync picks up a changed answer, a deleted member and an answer reset from the changes feed',
    async () => {
      const tokens = JSON.parse(fs.readFileSync(TOKENS!, 'utf8')) as Record<
        string,
        { token: string; userID?: string }
      >;
      const t2o = (method: string, path: string, tok: string, body?: unknown) =>
        fetch(`${BASE}/api/v1${path}`, {
          method,
          headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', origin: BASE! },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }).then(async (r) => ({ status: r.status, body: (await r.json()) as { data?: unknown } }));
      const db = t.app.get(Database).db;
      const mongo = t.app.get(Mongo);
      const sync = async () => {
        const r = await request(t.server).post(`/api/v1/connectors/${PANEL}/sync`).set(bearer()).expect(200);
        expect(r.body.status, JSON.stringify(r.body.error ?? '')).toBe('succeeded');
        return r.body;
      };
      const first = await sync();
      const [gone, reset] = DISPOSABLE as [string, string];
      // Change one select answer of a member who has a token to another option from the bank. On T2O that is the
      // consumer's employment status; elsewhere the first choice answer of the first member with answers.
      let pick: { memberId: string; token: string; qid: string; values: string[]; value: string } | undefined;
      for (const acct of Object.values(tokens)) {
        if (!acct.token || !acct.userID || [gone, reset].includes(acct.userID)) continue;
        const stored = await mongo.profileAnswers
          .find({ panel: PANEL, sourceMemberId: acct.userID }, { sort: { sourceQuestionId: 1 } })
          .toArray();
        stored.sort(
          (a, b) => Number(b.sourceQuestionId === 'empstat') - Number(a.sourceQuestionId === 'empstat'),
        );
        for (const a of stored) {
          const opts = ((await t2o('GET', `/option/${a.sourceQuestionId}`, acct.token)).body.data ?? []) as {
            value: string;
          }[];
          const value = opts.map((o) => o.value).find((v) => !a.values.includes(v));
          if (value) {
            pick = {
              memberId: acct.userID,
              token: acct.token,
              qid: a.sourceQuestionId,
              values: a.values,
              value,
            };
            break;
          }
        }
        if (pick) break;
      }
      expect(pick, 'a member with a choice answer in MADP').toBeTruthy();
      const { qid, value } = pick!;
      expect((await t2o('PATCH', '/me/profile', pick!.token, { [qid]: value })).status).toBe(200);
      const admin = tokens.integration!.token;
      expect((await t2o('POST', '/user/refresh', admin, { user: reset })).status).toBe(200);
      expect((await t2o('DELETE', `/user/${gone}`, admin)).status).toBe(200);
      await new Promise((r) => setTimeout(r, 6_000)); // the feed holds back the last 5 s

      const second = await sync();
      report.sync = { first: first.counts, second: second.counts };
      expect(second.counts.membersRemoved).toBe(1);
      expect(second.counts.answerResets).toBe(1);
      expect(second.counts.answersSeen).toBeGreaterThanOrEqual(1);
      const after = await mongo.profileAnswers.findOne({
        panel: PANEL,
        sourceMemberId: pick!.memberId,
        sourceQuestionId: qid,
      });
      expect(after?.values).toEqual([value]);
      expect(await mongo.profileAnswers.countDocuments({ panel: PANEL, sourceMemberId: gone })).toBe(0);
      expect(await mongo.profileAnswers.countDocuments({ panel: PANEL, sourceMemberId: reset })).toBe(0);
      const rows = await db.execute<{ status: string; email_enc: string | null; source_active: boolean }>(sql`
        select pm.status, si.email_enc, si.source_active from source_identity si
        join panel_membership pm on pm.source_identity_id = si.id where si.source_member_id = ${gone}`);
      expect(rows.rows[0]).toEqual({ status: 'deleted', email_enc: null, source_active: false });

      // Nothing new: the next run reads empty pages and changes nothing.
      const third = await sync();
      expect(third.counts).toMatchObject({ respondentsSeen: 0, answersSeen: 0, membersRemoved: 0 });
      // Every feed had something in the second run, so each now continues from its own cursor.
      expect(third.counts.startedFrom).toEqual({ members: 'cursor', answers: 'cursor', deletions: 'cursor' });
      report.sync = { ...(report.sync as object), third: third.counts };
    },
    SLOW,
  );
});
