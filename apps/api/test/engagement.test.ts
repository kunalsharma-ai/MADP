import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { startTestApp } from './helpers.js';

/**
 * Engagement studio on DEMO data: template review with four eyes, campaign approval, dry runs that apply consent,
 * minors, opt-outs, frequency caps and quiet hours, and the per-person timeline with its fatigue factors.
 * Nothing is ever sent.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;

const GOOD = {
  subject: 'News from {{panelName}}',
  bodyHtml:
    '<p>Hello {{firstName}},</p><p><a href="{{preferencesUrl}}">Preferences</a> · <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>',
  bodyText: 'Hello {{firstName}}. Preferences: {{preferencesUrl}} Unsubscribe: {{unsubscribeUrl}}',
};

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60' });
  for (const role of ['super_admin', 'data_steward', 'privacy_officer', 'analyst'] as const)
    tok[role] = (await t.adminToken(role)).token;
  await request(t.server).post('/api/v1/connectors/t2o/import').set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

async function approvedVersion(key: string, kind: string) {
  const tpl = await request(t.server)
    .post('/api/v1/communications/templates')
    .set(as('data_steward'))
    .send({ panel: 't2o', key, name: `T2O ${kind}`, kind })
    .expect(201);
  const v = await request(t.server)
    .post(`/api/v1/communications/templates/${tpl.body.id}/versions`)
    .set(as('data_steward'))
    .send(GOOD)
    .expect(201);
  await request(t.server).post(`/api/v1/communications/template-versions/${v.body.id}/submit`).set(as('data_steward')).expect(200);
  await request(t.server)
    .post(`/api/v1/communications/template-versions/${v.body.id}/review`)
    .set(as('privacy_officer'))
    .send({ decision: 'approve' })
    .expect(200);
  return v.body.id as string;
}

async function approvedCampaign(versionId: string, name: string) {
  const c = await request(t.server)
    .post('/api/v1/communications/campaigns')
    .set(as('data_steward'))
    .send({ name, templateVersionId: versionId })
    .expect(201);
  await request(t.server)
    .post(`/api/v1/communications/campaigns/${c.body.id}/decision`)
    .set(as('privacy_officer'))
    .send({ decision: 'approve' })
    .expect(200);
  return c.body.id as string;
}

describe('templates', () => {
  it('checks a version before review, and needs a second person to approve it', async () => {
    const tpl = await request(t.server)
      .post('/api/v1/communications/templates')
      .set(as('data_steward'))
      .send({ panel: 't2o', key: 'monthly-news', name: 'Monthly news', kind: 'newsletter' })
      .expect(201);
    await request(t.server)
      .post('/api/v1/communications/templates')
      .set(as('data_steward'))
      .send({ panel: 't2o', key: 'monthly-news', name: 'Again', kind: 'newsletter' })
      .expect(409);
    await request(t.server)
      .post('/api/v1/communications/templates')
      .set(as('analyst'))
      .send({ panel: 't2o', key: 'x-y', name: 'Nope', kind: 'newsletter' })
      .expect(403);

    const bad = await request(t.server)
      .post(`/api/v1/communications/templates/${tpl.body.id}/versions`)
      .set(as('data_steward'))
      .send({ subject: 'Hi', bodyHtml: '<p>Hi {{email}}</p>', bodyText: 'Hi' })
      .expect(201);
    expect(bad.body.problems).toContain('Unknown placeholder {{email}}');
    expect(bad.body.problems).toContain('The HTML part needs {{unsubscribeUrl}}');
    const refused = await request(t.server)
      .post(`/api/v1/communications/template-versions/${bad.body.id}/submit`)
      .set(as('data_steward'))
      .expect(400);
    expect(refused.body.problems.length).toBeGreaterThan(0);

    const good = await request(t.server)
      .post(`/api/v1/communications/templates/${tpl.body.id}/versions`)
      .set(as('data_steward'))
      .send(GOOD)
      .expect(201);
    expect(good.body).toMatchObject({ version: 2, status: 'draft', problems: [] });
    await request(t.server).post(`/api/v1/communications/template-versions/${good.body.id}/submit`).set(as('data_steward')).expect(200);
    // The steward cannot approve (no permission); a super admin who wrote a version cannot approve their own.
    await request(t.server)
      .post(`/api/v1/communications/template-versions/${good.body.id}/review`)
      .set(as('data_steward'))
      .send({ decision: 'approve' })
      .expect(403);
    const own = await request(t.server)
      .post(`/api/v1/communications/templates/${tpl.body.id}/versions`)
      .set(as('super_admin'))
      .send(GOOD)
      .expect(201);
    await request(t.server).post(`/api/v1/communications/template-versions/${own.body.id}/submit`).set(as('super_admin')).expect(200);
    await request(t.server)
      .post(`/api/v1/communications/template-versions/${own.body.id}/review`)
      .set(as('super_admin'))
      .send({ decision: 'approve' })
      .expect(403);
    await request(t.server)
      .post(`/api/v1/communications/template-versions/${good.body.id}/review`)
      .set(as('privacy_officer'))
      .send({ decision: 'approve', note: 'ok' })
      .expect(200);

    const preview = await request(t.server)
      .get(`/api/v1/communications/template-versions/${good.body.id}/preview`)
      .set(as('analyst'))
      .expect(403);
    void preview;
    const p = await request(t.server)
      .get(`/api/v1/communications/template-versions/${good.body.id}/preview`)
      .set(as('privacy_officer'))
      .expect(200);
    expect(p.body.subject).toBe('News from Turn2Opinion');
    expect(p.body.html).toContain('https://example.invalid/unsubscribe');
    // Sender, logo and legal footer come from Brands & settings.
    expect(p.body.from).toBe('Turn2Opinion <support@turn2opinion.com>');
    expect(p.body.html).toContain('/brands/t2o.png');
    expect(p.body.html).toContain('Frequent Research Fieldwork Solutions Private Limited');
    expect(p.body.html).toContain('https://www.turn2opinion.com/privacy/');
    expect(p.body.brandWarning).toBeNull();
    const kits = (await request(t.server).get('/api/v1/communications/templates').set(as('privacy_officer')).expect(200)).body.brandKits;
    expect(kits.mho.privacyUrl).toBeNull();
    expect(kits.mho.confirmed).toBe(false);
  });
});

describe('campaign dry runs', () => {
  it('only runs approved campaigns, approved by someone else, and never sends', async () => {
    const v = await approvedVersion('news-two', 'newsletter');
    const c = await request(t.server)
      .post('/api/v1/communications/campaigns')
      .set(as('data_steward'))
      .send({ name: 'News', templateVersionId: v })
      .expect(201);
    await request(t.server).post(`/api/v1/communications/campaigns/${c.body.id}/run`).set(as('data_steward')).send({}).expect(409);
    await request(t.server)
      .post(`/api/v1/communications/campaigns/${c.body.id}/decision`)
      .set(as('privacy_officer'))
      .send({ decision: 'approve' })
      .expect(200);
    await request(t.server)
      .post(`/api/v1/communications/campaigns/${c.body.id}/run`)
      .set(as('data_steward'))
      .send({ dryRun: false })
      .expect(403);
    // Marketing needs the e-mail marketing opt-in: members who never ticked it are held back.
    const r = await request(t.server)
      .post(`/api/v1/communications/campaigns/${c.body.id}/run`)
      .set(as('data_steward'))
      .send({})
      .expect(200);
    expect(r.body).toMatchObject({ dryRun: true, basis: 'marketing', consentRequired: 'email_marketing' });
    expect(r.body.reasons.no_consent).toBeGreaterThan(0);
    expect(r.body.audience).toBe(r.body.suppressed + r.body.planned);
    // Everyone planned ticked the opt-in.
    const [notOptedIn] = await q<{ n: string }>(sql`
      select count(*) as n from communication_event ce where ce.campaign_id = ${c.body.id} and ce.state = 'planned'
        and not exists (select 1 from consent_record cr where cr.master_person_id = ce.master_person_id and cr.panel = ce.panel
          and cr.purpose = 'email_marketing' and cr.status = 'granted')`);
    expect(Number(notOptedIn!.n)).toBe(0);
    const [sent] = await q<{ n: string }>(sql`select count(*) as n from communication_event where not dry_run`);
    expect(Number(sent!.n)).toBe(0);
  });

  it('plans onboarding messages for adults who accepted the terms, outside quiet hours, and applies caps and opt-outs', async () => {
    const id = await approvedCampaign(await approvedVersion('welcome', 'welcome'), 'Welcome');
    const first = await request(t.server).post(`/api/v1/communications/campaigns/${id}/run`).set(as('data_steward')).send({}).expect(200);
    expect(first.body.basis).toBe('onboarding');
    expect(first.body.planned).toBeGreaterThan(0);
    const [minors] = await q<{ n: string }>(sql`
      select count(distinct pm.master_person_id) as n from panel_membership pm
      join category_membership cm on cm.master_person_id = pm.master_person_id and cm.panel = pm.panel and cm.is_minor
      where pm.panel = 't2o' and pm.status = 'active'`);
    expect(first.body.reasons.minor_excluded ?? 0).toBe(Number(minors!.n));
    // Every planned send is outside 21:00-08:00 in the member's own time zone.
    const plannedRows = await q<{ planned_for: Date; tz: string | null }>(sql`
      select e.planned_for, si.timezone as tz from communication_event e
      join panel_membership pm on pm.master_person_id = e.master_person_id and pm.panel = e.panel
      join source_identity si on si.id = pm.source_identity_id
      where e.run_id = ${first.body.runId} and e.state = 'planned'`);
    for (const r of plannedRows) {
      const h = Number(
        new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: r.tz || 'UTC' }).format(new Date(r.planned_for)),
      );
      expect(h >= 8 && h < 21).toBe(true);
    }

    // Two real contacts this week for one member, and an opt-out for another (as a provider would report them).
    const [a, b] = await q<{ person: string }>(sql`
      select e.master_person_id as person from communication_event e where e.run_id = ${first.body.runId} and e.state = 'planned' limit 2`);
    await q(sql`insert into communication_event (data_mode, master_person_id, panel, channel, state, dry_run, occurred_at)
      values ('demo', ${a!.person}, 't2o', 'email', 'sent', false, now() - interval '1 day'),
             ('demo', ${a!.person}, 't2o', 'email', 'delivered', false, now() - interval '2 days'),
             ('demo', ${b!.person}, 't2o', 'email', 'opted_out', false, now() - interval '1 hour')`);
    const second = await request(t.server).post(`/api/v1/communications/campaigns/${id}/run`).set(as('data_steward')).send({}).expect(200);
    expect(second.body.planned).toBe(first.body.planned - 2);
    expect(second.body.reasons).toMatchObject({ frequency_cap_week: 1, opted_out: 1 });
    const why = await q<{ person: string; reason: string }>(sql`
      select master_person_id as person, reason from communication_event where run_id = ${second.body.runId} and state = 'suppressed'
      and reason in ('frequency_cap_week', 'opted_out')`);
    expect(Object.fromEntries(why.map((w) => [w.reason, w.person]))).toEqual({ frequency_cap_week: a!.person, opted_out: b!.person });

    // A higher weekly cap lets the first member through again; an invalid policy is refused.
    await request(t.server)
      .put('/api/v1/communications/policies/t2o')
      .set(as('privacy_officer'))
      .send({ maxPerWeek: 9, maxPerMonth: 5, quietStartHour: 21, quietEndHour: 8, bands: { high: 60, medium: 30 } })
      .expect(400);
    await request(t.server)
      .put('/api/v1/communications/policies/t2o')
      .set(as('privacy_officer'))
      .send({ maxPerWeek: 3, maxPerMonth: 6, quietStartHour: 21, quietEndHour: 8, bands: { high: 60, medium: 30 } })
      .expect(200);
    const third = await request(t.server).post(`/api/v1/communications/campaigns/${id}/run`).set(as('data_steward')).send({}).expect(200);
    expect(third.body.reasons.frequency_cap_week ?? 0).toBe(0);

    // The member's timeline: real contacts, the dry-run lines, and a fatigue score with its factors.
    await request(t.server).get(`/api/v1/communications/timeline/${a!.person}`).set(as('analyst')).expect(403);
    const tl = await request(t.server).get(`/api/v1/communications/timeline/${a!.person}`).set(as('privacy_officer')).expect(200);
    expect(tl.body.items.filter((i: { dryRun: boolean }) => !i.dryRun).map((i: { state: string }) => i.state).sort()).toEqual([
      'delivered',
      'sent',
    ]);
    expect(tl.body.items.some((i: { dryRun: boolean; campaign: string }) => i.dryRun && i.campaign === 'Welcome')).toBe(true);
    expect(tl.body.fatigue).toEqual([
      expect.objectContaining({ panel: 't2o', score: 30, band: 'medium' }),
    ]);
    const realOnly = await request(t.server)
      .get(`/api/v1/communications/timeline/${a!.person}?includeDryRuns=false`)
      .set(as('privacy_officer'))
      .expect(200);
    expect(realOnly.body.items).toHaveLength(2);
    const [audit] = await q<{ n: string }>(sql`select count(*) as n from audit_event where action = 'communications.timeline_viewed'`);
    expect(Number(audit!.n)).toBe(2);
  });

  it('refuses a campaign on a draft version and lets only approvers pause it', async () => {
    const tpl = await request(t.server)
      .post('/api/v1/communications/templates')
      .set(as('data_steward'))
      .send({ panel: 't2o', key: 'draft-only', name: 'Draft', kind: 'service' })
      .expect(201);
    const v = await request(t.server)
      .post(`/api/v1/communications/templates/${tpl.body.id}/versions`)
      .set(as('data_steward'))
      .send({ subject: 'Account notice', bodyHtml: '<p>Notice</p>', bodyText: 'Notice' })
      .expect(201);
    await request(t.server)
      .post('/api/v1/communications/campaigns')
      .set(as('data_steward'))
      .send({ name: 'Too early', templateVersionId: v.body.id })
      .expect(400);
    const id = await approvedCampaign(await approvedVersion('welcome-two', 'welcome'), 'Pausable');
    await request(t.server).post(`/api/v1/communications/campaigns/${id}/decision`).set(as('data_steward')).send({ decision: 'pause' }).expect(403);
    await request(t.server).post(`/api/v1/communications/campaigns/${id}/decision`).set(as('privacy_officer')).send({ decision: 'pause' }).expect(200);
    await request(t.server).post(`/api/v1/communications/campaigns/${id}/run`).set(as('data_steward')).send({}).expect(409);
  });
});
