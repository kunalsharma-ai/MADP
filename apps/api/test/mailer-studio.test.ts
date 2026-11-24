import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lintTemplate, render } from '../src/engagement/render.js';
import { ensureFooterLinks, flattenLiquid, liquidToStudio } from '../src/mailers/to-studio.js';
import { startTestApp } from './helpers.js';

/**
 * Mailer library to studio templates, for all three panels: a campaign mailer becomes a draft studio version with its
 * merge fields turned into studio placeholders, then goes through the studio's own review. Mailers that need Liquid
 * logic or values only the panel has at send time are refused with the reasons. Nothing is sent.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string, brand?: string) => ({ authorization: `Bearer ${tok[who]}`, ...(brand ? { 'x-madp-brand': brand } : {}) });

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '10' });
  for (const role of ['data_steward', 'privacy_officer', 'analyst'] as const) tok[role] = (await t.adminToken(role)).token;
}, 120_000);
afterAll(async () => t?.stop());

describe('converting Liquid', () => {
  it('maps fields and fallbacks, and reports logic, filters and panel-only fields', () => {
    expect(liquidToStudio('Hi {{ member.first_name | default: "there" }}, {{ user.mail }}').out).toBe(
      'Hi {{ firstName | default: "there" }}, {{email}}',
    );
    expect(liquidToStudio('{%- comment -%} notes {%- endcomment -%}Hi').blocks).toEqual([]);
    expect(liquidToStudio('{% if x %}a{% endif %}').blocks.map((b) => b.code)).toEqual(['liquid_logic']);
    expect(liquidToStudio('{{ profile.completed_count | times: 50 }}').blocks.map((b) => b.code)).toEqual(['filter']);
    expect(liquidToStudio('{{ survey.name }}').blocks.map((b) => b.code)).toEqual(['panel_field']);
  });

  it('renders fallbacks and the lint refuses anything left in braces', () => {
    const v = { subject: 'Hi {{ firstName | default: "there" }}', bodyHtml: '<p>{{x.y}}</p>', bodyText: '{% if a %}' };
    expect(render(v, {}).subject).toBe('Hi there');
    expect(render(v, { firstName: '<b>' }).html).toBe('<p>{{x.y}}</p>');
    const problems = lintTemplate('service', v);
    expect(problems).toContain('Not a studio placeholder: {{x.y}}');
    expect(problems).toContain('Not a studio placeholder: {% if a %}');
  });

  it('works out Liquid logic only when the audience fixes every value it tests', () => {
    const src = '{% assign n = profile.completed_count | default: 0 %}{% if n >= 1 and n < 5 %}few{% elsif n >= 5 %}many{% else %}none{% endif %} {{ member.first_name }}';
    expect(flattenLiquid(src, { 'profile.completed_count': 0 })).toBe('none {{ member.first_name }}');
    expect(flattenLiquid(src, { 'profile.completed_count': 3 })).toBe('few {{ member.first_name }}');
    expect(flattenLiquid('{% if a %}x{% else %}y{% endif %}', {})).toBeNull();
    expect(flattenLiquid('{% if n > 1 %}x{% endif %}', {})).toBeNull();
    expect(flattenLiquid('{% for x in list %}{% endfor %}', {})).toBeNull();
    expect(flattenLiquid('{% if n > 1 %}x', { n: 2 })).toBeNull();
    expect(flattenLiquid('{% if n > 1 %}{% if m == 0 %}a{% else %}b{% endif %}{% endif %}', { n: 0 })).toBe('');
  });

  it('adds footer links only where they are missing', () => {
    const done = ensureFooterLinks('<a href="{{preferencesUrl}}"></a><a href="{{unsubscribeUrl}}"></a>', '{{preferencesUrl}} {{unsubscribeUrl}}');
    expect(done.added).toEqual([]);
    const added = ensureFooterLinks('<html><body><p>x</p></body></html>', 'x');
    expect(added.added).toHaveLength(2);
    expect(added.html).toMatch(/Unsubscribe<\/a><\/p><\/body>/);
    expect(lintTemplate('birthday', { subject: 's', bodyHtml: added.html, bodyText: added.text })).toEqual([]);
  });
});

describe('mailer to studio template', () => {
  const CASES = [
    ['t2o', 't2o', 'birthday', 'birthday'],
    ['t2o', 't2o', 'case3-noprofiles', 'profile_recovery'],
    ['mfr', 'mfr-system', 'birthday', 'birthday'],
    ['mfr', 'mfr-lifecycle', 'case4-partial', 'profile_recovery'],
    ['mho', 'mho-patient', 'birthday', 'birthday'],
    ['mho', 'mho-hcp', 'birthday', 'birthday'],
  ] as const;

  it.each(CASES)('%s: %s/%s becomes a draft that passes the studio checks', async (panel, pack, id, kind) => {
    const r = await request(t.server).post(`/api/v1/communications/mailers/${pack}/${id}/studio`).set(as('data_steward', panel)).send({}).expect(201);
    expect(r.body.created).toBe(true);
    expect(r.body.template).toMatchObject({ panel, kind, key: `${pack}-${id}`, source: { pack, template: id } });
    expect(r.body.version).toMatchObject({ version: 1, status: 'draft', problems: [] });
    expect(r.body.version.bodyHtml).not.toMatch(/\{\{\s*(user|member|links)\./);
    expect(r.body.version.subject).toContain('{{');

    const p = await request(t.server).get(`/api/v1/communications/template-versions/${r.body.version.id}/preview`).set(as('data_steward')).expect(200);
    expect(p.body.problems).toEqual([]);
    expect(p.body.html).not.toContain('{{');
    expect(p.body.html).toContain('Sample');
    expect(p.body.html).toContain('https://example.invalid/unsubscribe');
    // The pack's own frame is kept; images point at the admin's copies.
    expect(p.body.html).toContain(`/mailers/${pack}/`);
    expect(p.body.html).not.toContain('[legal footer not set');
    if (id === 'case3-noprofiles') {
      expect(r.body.template.name).toContain('only members with no completed profile');
      expect(r.body.added[0]).toContain('Send it only to them');
      expect(r.body.version.bodyHtml).not.toMatch(/\{%/);
    }
  });

  it('a second import adds a version to the same template, and the studio review still applies', async () => {
    const again = await request(t.server).post('/api/v1/communications/mailers/mfr-system/birthday/studio').set(as('data_steward', 'mfr')).send({ subject: 2 }).expect(201);
    expect(again.body).toMatchObject({ created: false, version: { version: 2 } });
    expect(again.body.version.subject).toContain('Wishing you a wonderful day');
    const v = again.body.version.id as string;
    await request(t.server).post(`/api/v1/communications/template-versions/${v}/submit`).set(as('data_steward')).expect(200);
    await request(t.server).post(`/api/v1/communications/template-versions/${v}/review`).set(as('privacy_officer')).send({ decision: 'approve' }).expect(200);
    const list = await request(t.server).get('/api/v1/communications/templates?panel=mfr').set(as('data_steward')).expect(200);
    const tpl = list.body.items.find((x: { key: string }) => x.key === 'mfr-system-birthday');
    expect(tpl.versions.map((x: { status: string }) => x.status)).toEqual(['approved', 'draft']);
  });

  it('refuses mailers that need Liquid logic, panel-only values, or are not campaigns', async () => {
    for (const [panel, path, code] of [
      ['t2o', 't2o/case4-partial', 'liquid_logic'],
      ['mho', 'mho-caregiver/newsurvey', 'panel_field'],
      ['t2o', 't2o/forgot-password', 'not_a_campaign'],
    ] as const) {
      const r = await request(t.server).post(`/api/v1/communications/mailers/${path}/studio`).set(as('data_steward', panel)).send({}).expect(400);
      expect(r.body.blocks.map((b: { code: string }) => b.code), path).toContain(code);
      const d = await request(t.server).get(`/api/v1/communications/mailers/${path}`).set(as('data_steward', panel)).expect(200);
      expect(d.body.studio.map((b: { code: string }) => b.code)).toContain(code);
    }
    const ok = await request(t.server).get('/api/v1/communications/mailers/mho-caregiver/birthday').set(as('data_steward', 'mho')).expect(200);
    expect(ok.body.studio).toEqual([]);
  });

  it('needs the manage permission and one brand, and stays inside it', async () => {
    await request(t.server).post('/api/v1/communications/mailers/t2o/birthday/studio').set(as('analyst', 't2o')).send({}).expect(403);
    await request(t.server).post('/api/v1/communications/mailers/t2o/birthday/studio').set(as('data_steward', 'all')).send({}).expect(400);
    await request(t.server).post('/api/v1/communications/mailers/t2o/birthday/studio').set(as('data_steward', 'mho')).send({}).expect(404);
  });

  it('will not overwrite a studio template with the same key from somewhere else', async () => {
    await request(t.server)
      .post('/api/v1/communications/templates')
      .set(as('data_steward'))
      .send({ panel: 'mho', key: 'mho-caregiver-birthday', name: 'Hand-made', kind: 'birthday' })
      .expect(201);
    await request(t.server).post('/api/v1/communications/mailers/mho-caregiver/birthday/studio').set(as('data_steward', 'mho')).send({}).expect(409);
  });
});
