import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { FieldCrypto } from '../src/crypto/field-crypto.js';
import { startTestApp } from './helpers.js';

/**
 * Lifecycle automations and the celebration calendar on DEMO data, on all three panels: review with four eyes,
 * versioning and rollback, pause and resume, and dry runs for inactivity, incomplete profiles, registration,
 * birthdays and festivals. Nothing is ever sent.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;
const DAY = 86_400_000;

const GOOD = {
  subject: 'Hello from {{panelName}}',
  bodyHtml:
    '<p>Hello {{firstName}}, <a href="{{profileUrl}}">your profile</a>.</p><p><a href="{{preferencesUrl}}">Preferences</a> · <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>',
  bodyText: 'Hello {{firstName}}. Profile: {{profileUrl}} Preferences: {{preferencesUrl}} Unsubscribe: {{unsubscribeUrl}}',
};

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60' });
  for (const role of ['super_admin', 'data_steward', 'privacy_officer'] as const) tok[role] = (await t.adminToken(role)).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

let n = 0;
async function template(panel: string, kind: string, approve = true) {
  const tpl = await request(t.server)
    .post('/api/v1/communications/templates')
    .set(as('data_steward'))
    .send({ panel, key: `${kind.replace('_', '-')}-${++n}`, name: `${panel} ${kind}`, kind })
    .expect(201);
  const v = await request(t.server)
    .post(`/api/v1/communications/templates/${tpl.body.id}/versions`)
    .set(as('data_steward'))
    .send(GOOD)
    .expect(201);
  if (approve) {
    await request(t.server).post(`/api/v1/communications/template-versions/${v.body.id}/submit`).set(as('data_steward')).expect(200);
    await request(t.server)
      .post(`/api/v1/communications/template-versions/${v.body.id}/review`)
      .set(as('privacy_officer'))
      .send({ decision: 'approve' })
      .expect(200);
  }
  return { templateId: tpl.body.id as string, versionId: v.body.id as string };
}

/** Creates an automation as the steward and has the privacy officer approve version 1. */
async function automation(body: Record<string, unknown>) {
  const a = await request(t.server).post('/api/v1/communications/automations').set(as('data_steward')).send(body);
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  const v1 = a.body.versions[0].id;
  await request(t.server).post(`/api/v1/communications/automation-versions/${v1}/submit`).set(as('data_steward')).expect(200);
  await request(t.server)
    .post(`/api/v1/communications/automation-versions/${v1}/review`)
    .set(as('privacy_officer'))
    .send({ decision: 'approve' })
    .expect(200);
  return a.body.id as string;
}

const run = async (id: string, asOf: Date) => {
  const r = await request(t.server)
    .post(`/api/v1/communications/automations/${id}/run`)
    .set(as('data_steward'))
    .send({ asOf: asOf.toISOString() });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};

/** An active adult member of the panel with an e-mail, who never answered the marketing opt-in, and their person id. */
async function adult(panel: string) {
  const [m] = await q<{ person: string; joined_at: Date; dob: string; tz: string; country: string }>(sql`
    select pm.master_person_id as person, pm.joined_at, si.date_of_birth_enc as dob, si.timezone as tz, mp.country
    from panel_membership pm join source_identity si on si.id = pm.source_identity_id
    join master_person mp on mp.id = pm.master_person_id
    where pm.panel = ${panel} and pm.status = 'active' and si.email_enc is not null and si.email_verification <> 'rejected'
      and si.date_of_birth_enc is not null
      and not exists (select 1 from category_membership cm where cm.master_person_id = pm.master_person_id and cm.panel = pm.panel and cm.is_minor)
      and exists (select 1 from consent_record cr where cr.master_person_id = pm.master_person_id and cr.panel = pm.panel and cr.purpose = 'terms' and cr.status = 'granted')
      and not exists (select 1 from consent_record cr where cr.master_person_id = pm.master_person_id and cr.panel = pm.panel and cr.purpose = 'email_marketing')
    order by pm.joined_at limit 1`);
  return { ...m!, dob: t.app.get(FieldCrypto).decrypt(m!.dob)! };
}

const grantMarketing = (panel: string, person: string) =>
  q(sql`insert into consent_record (data_mode, master_person_id, panel, purpose, channel, status, evidence)
    values ('demo', ${person}, ${panel}, 'email_marketing', 'email', 'granted', '{"field":"test","value":"yes","version":null}'::jsonb)`);

describe('celebration calendar', () => {
  it('needs a second person to approve an entry', async () => {
    const c = await request(t.server)
      .post('/api/v1/communications/calendar')
      .set(as('super_admin'))
      .send({ panel: 't2o', name: 'Republic Day', observance: 'civic', onDate: '2027-01-26', countries: ['in'] })
      .expect(201);
    expect(c.body.status).toBe('pending');
    await request(t.server)
      .post(`/api/v1/communications/calendar/${c.body.id}/review`)
      .set(as('data_steward'))
      .send({ decision: 'approve' })
      .expect(403);
    await request(t.server)
      .post(`/api/v1/communications/calendar/${c.body.id}/review`)
      .set(as('super_admin'))
      .send({ decision: 'approve' })
      .expect(403);
    await request(t.server)
      .post(`/api/v1/communications/calendar/${c.body.id}/review`)
      .set(as('privacy_officer'))
      .send({ decision: 'approve' })
      .expect(200);
    const list = await request(t.server).get('/api/v1/communications/calendar?panel=t2o').set(as('data_steward')).expect(200);
    expect(list.body.items[0]).toMatchObject({ name: 'Republic Day', status: 'approved' });
    expect(list.body.rule).toMatch(/never inferred/);
  });
});

describe('automations', () => {
  it('checks templates, triggers and calendar entries before review', async () => {
    const welcome = await template('t2o', 'welcome');
    const bad = await request(t.server)
      .post('/api/v1/communications/automations')
      .set(as('data_steward'))
      .send({ panel: 't2o', name: 'Wrong kind', trigger: 'inactivity', steps: [{ atDays: 30, templateVersionId: welcome.versionId }] })
      .expect(400);
    expect(bad.body.problems[0]).toMatch(/needs a reengagement template/);
    const other = await template('mfr', 'reengagement');
    const cross = await request(t.server)
      .post('/api/v1/communications/automations')
      .set(as('data_steward'))
      .send({ panel: 't2o', name: 'Other panel', trigger: 'inactivity', steps: [{ atDays: 30, templateVersionId: other.versionId }] })
      .expect(400);
    expect(cross.body.problems).toContain('Step 30: the template belongs to another panel');
    const festival = await template('t2o', 'festival');
    const noDate = await request(t.server)
      .post('/api/v1/communications/automations')
      .set(as('data_steward'))
      .send({ panel: 't2o', name: 'No date', trigger: 'festival', steps: [{ atDays: 0, templateVersionId: festival.versionId }] })
      .expect(400);
    expect(noDate.body.problems).toContain('A festival automation needs a calendar entry');
    // A draft template is fine for a draft automation, but not for review.
    const draft = await template('t2o', 'reengagement', false);
    const a = await request(t.server)
      .post('/api/v1/communications/automations')
      .set(as('data_steward'))
      .send({ panel: 't2o', name: 'Draft tpl', trigger: 'inactivity', steps: [{ atDays: 30, templateVersionId: draft.versionId }] })
      .expect(201);
    const refused = await request(t.server)
      .post(`/api/v1/communications/automation-versions/${a.body.versions[0].id}/submit`)
      .set(as('data_steward'))
      .expect(400);
    expect(refused.body.problems[0]).toMatch(/draft, not approved/);
    await request(t.server).post(`/api/v1/communications/automations/${a.body.id}/run`).set(as('data_steward')).send({}).expect(409);
  });

  it('inactivity: steps by days idle, marketing consent, no repeats, and stops on reactivation', async () => {
    const tv = await template('t2o', 'reengagement');
    const id = await automation({
      panel: 't2o',
      name: 'Win back',
      trigger: 'inactivity',
      config: { minDaysBetween: 7 },
      steps: [15, 30, 60, 90].map((atDays) => ({ atDays, templateVersionId: tv.versionId })),
    });
    const later = new Date(Date.now() + 400 * DAY);
    const first = await run(id, later);
    expect(first.qualifyingActivity).toEqual(['joined', 'profile_answer_updated', 'survey_response', 'message_opened_or_clicked']);
    expect(first.due).toBeGreaterThan(0);
    expect(Object.keys(first.byStep)).toEqual(['90']);
    // A marketing message reaches only members who ticked the opt-in: the rest are held back.
    const [optedIn] = await q<{ n: string }>(sql`
      select count(*) as n from consent_record where panel = 't2o' and purpose = 'email_marketing' and status = 'granted'`);
    expect(first.planned).toBeGreaterThan(0);
    expect(first.planned).toBeLessThanOrEqual(Number(optedIn!.n));
    expect(first.reasons.no_consent).toBeGreaterThan(0);
    expect(first.consentsRequired).toEqual(['email_marketing']);

    const m = await adult('t2o');
    await grantMarketing('t2o', m.person);
    const second = await run(id, later);
    expect(second.planned).toBe(first.planned + 1);
    const [ev] = await q<{ state: string; step: number; dry_run: boolean }>(sql`
      select state, step, dry_run from communication_event where automation_run_id = ${second.runId} and master_person_id = ${m.person}`);
    expect(ev).toMatchObject({ state: 'planned', step: 90, dry_run: true });

    // A real send of step 90 a day before: that step is not repeated.
    const sentAt = new Date(later.getTime() - DAY);
    await q(sql`insert into communication_event (data_mode, master_person_id, panel, automation_id, step, channel, state, dry_run, occurred_at)
      values ('demo', ${m.person}, 't2o', ${id}, 90, 'email', 'sent', false, ${sentAt})`);
    const third = await run(id, later);
    // Only this member's step is skipped; the other opted-in members are still planned.
    expect(third.planned).toBe(first.planned);
    const [again] = await q<{ reason: string }>(sql`
      select reason from communication_event where automation_run_id = ${third.runId} and master_person_id = ${m.person}`);
    expect(again!.reason).toBe('already_sent');

    // A click after that message is activity: the member is no longer idle, so no step is due.
    await q(sql`insert into communication_event (data_mode, master_person_id, panel, automation_id, step, channel, state, dry_run, occurred_at)
      values ('demo', ${m.person}, 't2o', ${id}, 90, 'email', 'clicked', false, ${new Date(later.getTime() - DAY / 2)})`);
    const fourth = await run(id, later);
    expect(await q(sql`select 1 from communication_event where automation_run_id = ${fourth.runId} and master_person_id = ${m.person}`)).toHaveLength(0);
    // Twenty days later the member is idle again and starts over at step 15; the 7-day spacing has passed.
    const fifth = await run(id, new Date(later.getTime() + 20 * DAY));
    const [restart] = await q<{ state: string; step: number }>(sql`
      select state, step from communication_event where automation_run_id = ${fifth.runId} and master_person_id = ${m.person}`);
    expect(restart).toMatchObject({ state: 'planned', step: 15 });

    await request(t.server).post(`/api/v1/communications/automations/${id}/run`).set(as('data_steward')).send({ dryRun: false }).expect(403);
  });

  it('incomplete profile: required questions in priority order, onboarding basis, stops when complete', async () => {
    const tv = await template('mfr', 'profile_recovery');
    const required = ['demo-question-that-nobody-answered'];
    const id = await automation({
      panel: 'mfr',
      name: 'Finish your profile',
      trigger: 'incomplete_profile',
      config: { completionThreshold: 0.5, requiredQuestionIds: required },
      steps: [{ atDays: 3, templateVersionId: tv.versionId }],
    });
    const r = await run(id, new Date(Date.now() + 30 * DAY));
    expect(r.questionBank).toBeGreaterThan(0);
    // Nobody answered the first required question, so every member with a join date is due and it tops the list.
    expect(r.notDue).toBe(0);
    expect(r.topMissingQuestions[0]).toMatchObject({ questionId: 'demo-question-that-nobody-answered' });
    expect(r.consentsRequired).toEqual(['terms']);
    expect(r.planned).toBeGreaterThan(0);
  });

  it('registration: each step only in its window, on MFR and MHO as well', async () => {
    for (const panel of ['t2o', 'mfr', 'mho']) {
      const welcome = await template(panel, 'welcome');
      const id = await automation({
        panel,
        name: `${panel} onboarding`,
        trigger: 'registration',
        steps: [{ atDays: 0, templateVersionId: welcome.versionId }],
      });
      const m = await adult(panel);
      const onDay = await run(id, new Date(new Date(m.joined_at).getTime() + 3_600_000));
      const [ev] = await q<{ state: string; step: number }>(sql`
        select state, step from communication_event where automation_run_id = ${onDay.runId} and master_person_id = ${m.person}`);
      expect(ev, panel).toMatchObject({ step: 0 });
      // A year later the welcome is long past: nobody is swept in.
      const late = await run(id, new Date(Date.now() + 365 * DAY));
      expect(late.due, panel).toBe(0);
    }
  });

  it('birthday: on the member’s local date, with marketing consent', async () => {
    const tv = await template('mho', 'birthday');
    const id = await automation({ panel: 'mho', name: 'Birthday', trigger: 'birthday', steps: [{ atDays: 0, templateVersionId: tv.versionId }] });
    const m = await adult('mho');
    const year = new Date().getUTCFullYear() + 1;
    const md = m.dob.slice(5, 10) === '02-29' ? '02-28' : m.dob.slice(5, 10);
    const day = await run(id, new Date(`${year}-${md}T12:00:00Z`));
    const [ev] = await q<{ state: string; reason: string | null }>(sql`
      select state, reason from communication_event where automation_run_id = ${day.runId} and master_person_id = ${m.person}`);
    expect(ev).toMatchObject({ state: 'suppressed', reason: 'no_consent' });
    await grantMarketing('mho', m.person);
    const granted = await run(id, new Date(`${year}-${md}T12:00:00Z`));
    const [ok] = await q<{ state: string }>(sql`
      select state from communication_event where automation_run_id = ${granted.runId} and master_person_id = ${m.person}`);
    expect(ok!.state).toBe('planned');
  });

  it('festival: civic entries by country, religious or cultural ones only by choice', async () => {
    const m = await adult('t2o');
    await grantMarketing('t2o', m.person);
    const today = new Date(Date.now() + 10 * DAY);
    const onDate = today.toISOString().slice(0, 10);
    const asOf = new Date(`${onDate}T12:00:00Z`);
    const results: Record<string, { reasons: Record<string, number>; due: number }> = {};
    for (const observance of ['civic', 'religious_cultural']) {
      const c = await request(t.server)
        .post('/api/v1/communications/calendar')
        .set(as('data_steward'))
        .send({ panel: 't2o', name: `Test ${observance}`, observance, onDate, countries: [m.country] })
        .expect(201);
      await request(t.server)
        .post(`/api/v1/communications/calendar/${c.body.id}/review`)
        .set(as('privacy_officer'))
        .send({ decision: 'approve' })
        .expect(200);
      const tv = await template('t2o', 'festival');
      const id = await automation({
        panel: 't2o',
        name: `Greeting ${observance}`,
        trigger: 'festival',
        config: { celebrationId: c.body.id },
        steps: [{ atDays: 0, templateVersionId: tv.versionId }],
      });
      results[observance] = await run(id, asOf);
      expect((await run(id, new Date(asOf.getTime() + 3 * DAY))).due).toBe(0);
    }
    expect(results.civic!.due).toBeGreaterThan(0);
    expect(results.civic!.reasons.no_greeting_preference).toBeUndefined();
    // The t2o member granted marketing consent here is planned for the civic greeting only.
    expect((results.civic as unknown as { planned: number }).planned).toBeGreaterThanOrEqual(1);
    expect((results.religious_cultural as unknown as { planned: number }).planned).toBe(0);
    expect(results.religious_cultural!.reasons.no_greeting_preference).toBe(results.religious_cultural!.due);
  });

  it('pauses, resumes, rolls back through review, and skips a step whose template was retired', async () => {
    const tv = await template('t2o', 'reengagement');
    const id = await automation({
      panel: 't2o',
      name: 'Versioned',
      trigger: 'inactivity',
      steps: [{ atDays: 30, templateVersionId: tv.versionId }],
    });
    await request(t.server).post(`/api/v1/communications/automations/${id}/decision`).set(as('privacy_officer')).send({ decision: 'pause' }).expect(200);
    await request(t.server).post(`/api/v1/communications/automations/${id}/run`).set(as('data_steward')).send({}).expect(409);
    await request(t.server).post(`/api/v1/communications/automations/${id}/decision`).set(as('privacy_officer')).send({ decision: 'resume' }).expect(200);

    const v2 = await request(t.server)
      .post(`/api/v1/communications/automations/${id}/versions`)
      .set(as('data_steward'))
      .send({ steps: [{ atDays: 60, templateVersionId: tv.versionId }] })
      .expect(201);
    await request(t.server).post(`/api/v1/communications/automation-versions/${v2.body.id}/submit`).set(as('data_steward')).expect(200);
    await request(t.server).post(`/api/v1/communications/automation-versions/${v2.body.id}/review`).set(as('data_steward')).send({ decision: 'approve' }).expect(403);
    await request(t.server).post(`/api/v1/communications/automation-versions/${v2.body.id}/review`).set(as('privacy_officer')).send({ decision: 'approve' }).expect(200);
    let a = (await request(t.server).get(`/api/v1/communications/automations/${id}`).set(as('data_steward')).expect(200)).body;
    expect(a.currentVersionId).toBe(v2.body.id);
    expect(a.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(['2:approved', '1:superseded']);

    // Rollback to version 1 is a new version 3 that goes through review.
    const v1 = a.versions[1].id;
    const v3 = await request(t.server).post(`/api/v1/communications/automation-versions/${v1}/restore`).set(as('data_steward')).expect(201);
    expect(v3.body).toMatchObject({ version: 3, status: 'draft', restoredFrom: v1 });
    await request(t.server).post(`/api/v1/communications/automation-versions/${v3.body.id}/submit`).set(as('data_steward')).expect(200);
    await request(t.server).post(`/api/v1/communications/automation-versions/${v3.body.id}/review`).set(as('privacy_officer')).send({ decision: 'approve' }).expect(200);
    a = (await request(t.server).get(`/api/v1/communications/automations/${id}`).set(as('data_steward')).expect(200)).body;
    expect(a.currentVersionId).toBe(v3.body.id);

    // Approving a new template version retires the one the step uses; the run skips that step and says so.
    const next = await request(t.server)
      .post(`/api/v1/communications/templates/${tv.templateId}/versions`)
      .set(as('data_steward'))
      .send(GOOD)
      .expect(201);
    await request(t.server).post(`/api/v1/communications/template-versions/${next.body.id}/submit`).set(as('data_steward')).expect(200);
    await request(t.server).post(`/api/v1/communications/template-versions/${next.body.id}/review`).set(as('privacy_officer')).send({ decision: 'approve' }).expect(200);
    const r = await run(id, new Date(Date.now() + 400 * DAY));
    expect(r.stepsSkipped).toEqual([30]);
    expect(r.due).toBe(0);

    const runs = (await request(t.server).get(`/api/v1/communications/automations/${id}`).set(as('data_steward')).expect(200)).body.runs;
    expect(runs).toHaveLength(1);
    const audit = await q<{ action: string }>(sql`select action from audit_event where target_id = ${id} order by at`);
    expect(audit.map((x) => x.action)).toEqual(['automation.created', 'automation.pause', 'automation.resume', 'automation.dry_run']);
  });

  it('shows automation lines on the person timeline', async () => {
    const m = await adult('t2o');
    const r = await request(t.server).get(`/api/v1/communications/timeline/${m.person}?panel=t2o`).set(as('data_steward')).expect(200);
    const line = r.body.items.find((i: { automation: string | null }) => i.automation === 'Win back');
    expect(line).toMatchObject({ trigger: 'inactivity', dryRun: true });
  });
});

describe('welcome journey', () => {
  it('sets up day 1, 3 and 7 on each panel from approved templates, and waits for a second admin', async () => {
    const before = (await request(t.server).get('/api/v1/communications/automations/welcome-journey').set(as('data_steward')).expect(200)).body;
    expect(before.map((p: { panel: string }) => p.panel).sort()).toEqual(['mfr', 'mho', 't2o']);
    for (const panel of ['t2o', 'mfr', 'mho']) {
      // Without an approved survey reminder the journey can't start, and says what is missing.
      await template(panel, 'welcome');
      await template(panel, 'profile_recovery');
      const missing = await request(t.server).post('/api/v1/communications/automations/welcome-journey').set(as('data_steward')).send({ panel });
      if (missing.status === 400) {
        expect(missing.body.problems.join(' ')).toMatch(/Day 7: a survey reminder template/);
        await template(panel, 'survey_reminder');
      } else expect(missing.status, JSON.stringify(missing.body)).toBe(409);
      const made = await request(t.server).post('/api/v1/communications/automations/welcome-journey').set(as('data_steward')).send({ panel });
      if (made.status === 409) continue;
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect(made.body).toMatchObject({ panel, trigger: 'registration', name: 'Welcome journey', status: 'draft' });
      const v = made.body.versions[0];
      expect(v.status).toBe('in_review');
      expect(v.steps.map((s: { atDays: number; onlyIfIncomplete: boolean }) => `${s.atDays}:${s.onlyIfIncomplete}`)).toEqual(['1:false', '3:true', '7:false']);
      // The author can't approve their own journey; a second admin does.
      await request(t.server).post(`/api/v1/communications/automation-versions/${v.id}/review`).set(as('data_steward')).send({ decision: 'approve' }).expect(403);
      await request(t.server).post(`/api/v1/communications/automation-versions/${v.id}/review`).set(as('privacy_officer')).send({ decision: 'approve' }).expect(200);
      // One journey per panel, and it never sends.
      await request(t.server).post('/api/v1/communications/automations/welcome-journey').set(as('data_steward')).send({ panel }).expect(409);
      await request(t.server).post(`/api/v1/communications/automations/${made.body.id}/run`).set(as('data_steward')).send({ dryRun: false }).expect(403);
    }
    const after = (await request(t.server).get('/api/v1/communications/automations/welcome-journey').set(as('data_steward')).expect(200)).body;
    for (const p of after) {
      expect(p.automation).toMatchObject({ status: 'active', versionStatus: 'approved' });
      expect(p.steps.every((s: { template: unknown }) => s.template)).toBe(true);
    }
  });
});
