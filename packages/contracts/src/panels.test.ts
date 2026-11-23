import { describe, expect, it } from 'vitest';
import { PANEL_CODES, PANELS, SOURCE_CATEGORY_PROPOSALS, CountsResponse } from './index.js';

describe('panel registry', () => {
  it('has all three mandatory panels', () => {
    expect(PANEL_CODES).toEqual(['t2o', 'mfr', 'mho']);
    expect(PANELS.mho.sensitive).toBe(true);
  });
  it('flags minor source categories for review', () => {
    expect(SOURCE_CATEGORY_PROPOSALS.filter((p) => p.minor).map((p) => p.sourceValue).sort()).toEqual(['minor', 'minor', 'minor patient']);
    for (const panel of PANEL_CODES) expect(SOURCE_CATEGORY_PROPOSALS.some((p) => p.panel === panel)).toBe(true);
  });
  it('counts contract requires an explicit data mode', () => {
    expect(() => CountsResponse.parse({ uniquePeople: 1 })).toThrow();
  });
});
