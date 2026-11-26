import { describe, expect, it } from 'vitest';
import type { Permission } from '@madp/contracts';
import { computeAccess, covers, hasOn } from './access.js';

const roles = new Map<string, Permission[]>([
  ['brand_admin', ['members.read', 'points.adjust']],
  ['support_agent', ['members.read', 'support.read']],
  ['super_admin', ['members.read', 'points.adjust', 'support.read', 'switches.flip']],
]);

describe('computeAccess', () => {
  it('limits a brand admin for MFR to MFR', () => {
    const a = computeAccess([{ role: 'brand_admin', brands: ['mfr'] }], roles);
    expect(a.brands).toEqual(['mfr']);
    expect(a.brandPermissions.t2o).toBeUndefined();
    expect(a.permissions).toEqual([]);
    expect(hasOn(a, 'mfr', ['points.adjust'])).toBe(true);
    expect(hasOn(a, 't2o', ['members.read'])).toBe(false);
    expect(hasOn(a, 'all', ['members.read'])).toBe(false);
  });

  it('treats a null brand list as every brand and intersects for cross-brand routes', () => {
    const a = computeAccess(
      [
        { role: 'support_agent', brands: null },
        { role: 'brand_admin', brands: ['t2o', 'mho'] },
      ],
      roles,
    );
    expect(a.brands).toEqual(['t2o', 'mfr', 'mho']);
    expect(a.permissions).toEqual(['members.read', 'support.read']);
    expect(hasOn(a, 'mho', ['points.adjust'])).toBe(true);
    expect(hasOn(a, 'mfr', ['points.adjust'])).toBe(false);
  });

  it('ignores grants of unknown roles', () => {
    expect(computeAccess([{ role: 'gone', brands: null }], roles).brands).toEqual([]);
  });

  it('refuses to let an admin grant more than they hold', () => {
    const mfrAdmin = computeAccess([{ role: 'brand_admin', brands: ['mfr'] }], roles);
    expect(covers(mfrAdmin, computeAccess([{ role: 'support_agent', brands: ['t2o'] }], roles))).toBe(false);
    expect(covers(mfrAdmin, computeAccess([{ role: 'super_admin', brands: ['mfr'] }], roles))).toBe(false);
    const sup = computeAccess([{ role: 'super_admin', brands: null }], roles);
    expect(covers(sup, computeAccess([{ role: 'brand_admin', brands: ['mfr'] }], roles))).toBe(true);
  });
});

describe('sensitive panels added in the console', () => {
  const r = new Map<string, Permission[]>([
    ['dpo', ['members.read', 'health.sensitive.read']],
    ['super_admin', ['members.read', 'health.sensitive.read']],
  ]);
  const panels = ['t2o', 'mfr', 'mho', 'kidz'];

  it('an all-brands grant opens no health data there, except for super_admin', () => {
    const a = computeAccess([{ role: 'dpo', brands: null }], r, panels, ['kidz']);
    expect(hasOn(a, 'mho', ['health.sensitive.read'])).toBe(true);
    expect(hasOn(a, 'kidz', ['health.sensitive.read'])).toBe(false);
    expect(hasOn(a, 'kidz', ['members.read'])).toBe(true);
    expect(a.permissions).toEqual(['members.read']);
    const sup = computeAccess([{ role: 'super_admin', brands: null }], r, panels, ['kidz']);
    expect(hasOn(sup, 'kidz', ['health.sensitive.read'])).toBe(true);
  });

  it('a grant that names the panel opens it', () => {
    const a = computeAccess([{ role: 'dpo', brands: panels }], r, panels, ['kidz']);
    expect(hasOn(a, 'kidz', ['health.sensitive.read'])).toBe(true);
    expect(a.permissions).toContain('health.sensitive.read');
  });
});
