import { describe, expect, it } from 'vitest';
import { AboutYouSave } from './panel-admin.js';

describe('AboutYouSave', () => {
  it('takes one About You profile per group, slugs lower-cased, and needs a reason', () => {
    const r = AboutYouSave.parse({
      groups: [['Basic'], ['finance', 'financial']],
      reason: 'MFR keeps Finance',
    });
    expect(r.groups).toEqual([['basic'], ['finance', 'financial']]);
    expect(r.byCategory).toEqual({});
    expect(AboutYouSave.safeParse({ groups: [['basic']] }).success).toBe(false);
  });

  it('null goes back to the default; a segment may have its own (or an empty) list', () => {
    const r = AboutYouSave.parse({
      groups: null,
      byCategory: { B2B: [], 'b2c-minor': null },
      reason: 'Teens default',
    });
    expect(r.groups).toBeNull();
    expect(r.byCategory).toEqual({ b2b: [], 'b2c-minor': null });
  });

  it('refuses an empty brand list, bad slugs and unknown fields', () => {
    expect(AboutYouSave.safeParse({ groups: [], reason: 'nothing at all' }).success).toBe(false);
    expect(AboutYouSave.safeParse({ groups: [['not a slug!']], reason: 'bad slug here' }).success).toBe(
      false,
    );
    expect(AboutYouSave.safeParse({ groups: [['basic']], reason: 'extra field', on: true }).success).toBe(
      false,
    );
  });
});
