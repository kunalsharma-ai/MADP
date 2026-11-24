import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/**
 * Mailer library: the owner's six packs for all three panels (T2O, MFR lifecycle and system, MHO HCP, caregiver and
 * patient), read-only. Every merge field is mapped to a source, the selected brand limits what is shown, and previews
 * use the designers' sample data with images pointed at the admin's copies.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string, brand?: string) => ({ authorization: `Bearer ${tok[who]}`, ...(brand ? { 'x-madp-brand': brand } : {}) });
type Pack = { id: string; panel: string; category: string | null; templates: { id: string; fields: string[]; unmappedFields: string[]; transactional: boolean; campaignKind: string | null }[] };

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '10' });
  for (const role of ['super_admin', 'data_steward', 'analyst'] as const) tok[role] = (await t.adminToken(role)).token;
  tok.mhoManager = (await t.adminToken('panel_manager', 'mho.mailers@example.invalid', ['mho'])).token;
});
afterAll(async () => t?.stop());

describe('mailer library', () => {
  it('lists all six packs for all three panels, with every merge field mapped', async () => {
    const r = await request(t.server).get('/api/v1/communications/mailers').set(as('data_steward')).expect(200);
    const packs = r.body.packs as Pack[];
    expect(packs.map((p) => p.id).sort()).toEqual(['mfr-lifecycle', 'mfr-system', 'mho-caregiver', 'mho-hcp', 'mho-patient', 't2o']);
    expect(new Set(packs.map((p) => p.panel))).toEqual(new Set(['t2o', 'mfr', 'mho']));
    expect(packs.reduce((n, p) => n + p.templates.length, 0)).toBe(98);
    expect(packs.filter((p) => p.panel === 'mho').map((p) => p.category).sort()).toEqual(['caregiver', 'healthcare_professional', 'patient']);
    for (const p of packs) for (const tp of p.templates) expect(tp.unmappedFields, `${p.id}/${tp.id}`).toEqual([]);
    // Only marketing and lifecycle mailers can become MADP campaigns; account and support mail stays with the panel.
    const t2o = packs.find((p) => p.id === 't2o')!;
    expect(t2o.templates.find((x) => x.id === 'forgot-password')).toMatchObject({ transactional: true, campaignKind: null });
    expect(t2o.templates.find((x) => x.id === 'case4-partial')?.campaignKind).toBe('profile_recovery');
  });

  it('shows the Liquid source and where each field comes from', async () => {
    const r = await request(t.server).get('/api/v1/communications/mailers/mho-hcp/invite').set(as('data_steward')).expect(200);
    expect(r.body.pack).toMatchObject({ panel: 'mho', category: 'healthcare_professional' });
    expect(r.body.liquid).toContain('{{');
    expect(r.body.text.length).toBeGreaterThan(50);
    expect(r.body.fields.every((f: { source: string | null }) => f.source)).toBe(true);
  });

  it('previews with sample data and local images, never member data', async () => {
    const r = await request(t.server).get('/api/v1/communications/mailers/t2o/newsurvey/preview').set(as('data_steward')).expect(200);
    expect(r.body.html).toContain('/mailers/t2o/');
    expect(r.body.html).not.toContain('https://www.frequentresearch.com/mailer/t2o-v1/');
    expect(r.body.html).not.toMatch(/@example\.invalid/);
    expect(r.body.subject).not.toContain('{{');
  });

  it('checks the permission and the selected brand', async () => {
    await request(t.server).get('/api/v1/communications/mailers').set(as('analyst')).expect(403);
    const mho = await request(t.server).get('/api/v1/communications/mailers').set(as('mhoManager', 'mho'));
    if (mho.status === 200) {
      expect(new Set((mho.body.packs as Pack[]).map((p) => p.panel))).toEqual(new Set(['mho']));
      await request(t.server).get('/api/v1/communications/mailers/t2o/invite').set(as('mhoManager', 'mho')).expect(404);
    } else expect(mho.status).toBe(403);
    await request(t.server).get('/api/v1/communications/mailers/t2o/nope').set(as('data_steward')).expect(404);
    await request(t.server).get('/api/v1/communications/mailers/..%2F..%2Fetc/passwd').set(as('data_steward')).expect(400);
  });
});
