import { describe, expect, it } from 'vitest';
import { resolveFields, type PrecedenceInput } from './precedence.js';

const id = (over: Partial<PrecedenceInput> & Pick<PrecedenceInput, 'id'>): PrecedenceInput => ({
  panel: 't2o',
  deleted: false,
  emailVerified: false,
  sourceUpdatedAt: null,
  createdAt: new Date('2026-01-01'),
  values: {},
  ...over,
});

describe('source precedence', () => {
  it('prefers a verified e-mail, then the latest source update, then the first seen', () => {
    const r = resolveFields([
      id({ id: 'a', panel: 'mfr', sourceUpdatedAt: new Date('2026-11-20'), values: { city: 'mumbai', gender: 'm' } }),
      id({ id: 'b', panel: 't2o', emailVerified: true, values: { city: 'pune' } }),
      id({ id: 'c', panel: 'mho', sourceUpdatedAt: new Date('2026-11-01'), values: { city: 'delhi', birthYear: 1980 } }),
    ]);
    expect(r.values).toEqual({ country: null, state: null, city: 'pune', gender: 'm', birthYear: 1980 });
    expect(r.sources).toEqual({
      city: { panel: 't2o', sourceIdentityId: 'b' },
      gender: { panel: 'mfr', sourceIdentityId: 'a' },
      birthYear: { panel: 'mho', sourceIdentityId: 'c' },
    });
  });

  it('breaks a full tie by who MADP saw first', () => {
    const r = resolveFields([
      id({ id: 'late', createdAt: new Date('2026-02-01'), values: { country: 'gb' } }),
      id({ id: 'early', createdAt: new Date('2026-01-01'), values: { country: 'in' } }),
    ]);
    expect(r.values.country).toBe('in');
  });

  it('ignores deleted memberships and empty values', () => {
    const r = resolveFields([
      id({ id: 'gone', emailVerified: true, deleted: true, values: { city: 'pune' } }),
      id({ id: 'blank', emailVerified: true, values: { city: '' } }),
      id({ id: 'kept', values: { city: 'nagpur' } }),
    ]);
    expect(r.values.city).toBe('nagpur');
    expect(resolveFields([id({ id: 'gone', deleted: true, values: { city: 'x' } })]).values.city).toBeNull();
  });
});
