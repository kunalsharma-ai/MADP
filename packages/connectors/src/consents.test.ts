import { describe, expect, it } from 'vitest';
import { mapConsents, mapQuestionnaire, mapUser, type RawUser } from './index.js';

const teen = (parent: RawUser['parent']): RawUser => ({ _id: 'u1', category: 'minor', parent });

describe('mapConsents (T2O backend User)', () => {
  it('reads guardian consent in the same order as the member area', () => {
    const status = (p: RawUser['parent']) =>
      mapConsents(teen(p)).find((c) => c.purpose === 'guardian_consent')?.status;
    expect(status({ consentStatus: 'approved' })).toBe('granted');
    expect(status({ consent: true, consentStatus: 'pending' })).toBe('granted');
    expect(status({ consentStatus: 'declined' })).toBe('denied');
    expect(status({ decision: 'no' })).toBe('denied');
    expect(status({ consentStatus: 'withdrawn' })).toBe('withdrawn');
    expect(status({ consentStatus: 'expired' })).toBe('unknown');
    expect(status({ consentStatus: 'pending' })).toBe('unknown');
    expect(status(undefined)).toBe('unknown');
  });

  it('keeps the version and time, and never copies guardian contact details or IP', () => {
    const raw = {
      ...teen({ consentStatus: 'approved', consentAt: '2026-11-21T10:00:00Z', consentVersion: 'teen-v2' }),
    } as RawUser & { parent: Record<string, unknown> };
    Object.assign(raw.parent, {
      email: 'guardian@example.invalid',
      phone: '+10000000000',
      consentIP: '203.0.113.9',
      name: { first: 'Guard' },
    });
    const [g] = mapConsents(raw);
    expect(g).toEqual({
      purpose: 'guardian_consent',
      status: 'granted',
      capturedAt: '2026-11-21T10:00:00.000Z',
      evidence: { field: 'parent.consentStatus', value: 'approved', version: 'teen-v2' },
    });
    const text = JSON.stringify(mapConsents(raw));
    for (const pii of ['guardian@', '+1000', '203.0.113.9', 'Guard']) expect(text).not.toContain(pii);
  });

  it('adds no guardian record for adults without parent data', () => {
    expect(mapConsents({ _id: 'a', category: 'b2c' }).some((c) => c.purpose === 'guardian_consent')).toBe(
      false,
    );
  });

  it('maps terms and the opt-in flags', () => {
    const c = mapConsents({
      _id: 'a',
      category: 'b2c',
      terms: ['tos-2025', 'privacy-2026'],
      consent: { canAcceptPushNotification: true, canShareVideo: false },
    });
    expect(c).toEqual([
      {
        purpose: 'terms',
        status: 'granted',
        capturedAt: null,
        evidence: { field: 'terms', value: null, version: 'tos-2025,privacy-2026' },
      },
      {
        purpose: 'push_notifications',
        status: 'granted',
        capturedAt: null,
        evidence: { field: 'consent.canAcceptPushNotification', value: 'true', version: null },
      },
      {
        purpose: 'video_sharing',
        status: 'denied',
        capturedAt: null,
        evidence: { field: 'consent.canShareVideo', value: 'false', version: null },
      },
    ]);
  });

  it('is part of every mapped respondent, for all three panels', () => {
    for (const panel of ['t2o', 'mfr', 'mho'] as const)
      expect(mapUser(panel, teen({ consentStatus: 'approved' })).consents[0]?.purpose).toBe(
        'guardian_consent',
      );
  });
});

describe('mapQuestionnaire', () => {
  it('drops blank question slots in a page (the T2O bank has two)', () => {
    const q = mapQuestionnaire('t2o', {
      name: 'Shopping',
      slug: 'shopping',
      category: 'b2c',
      pages: [['Shopping', 'shop1', '', 'shop2']],
    });
    expect(q.pages).toEqual([['Shopping', 'shop1', 'shop2']]);
  });
});

describe('mapUser staff flag', () => {
  it('passes isStaff through only when the panel sets it', () => {
    expect(mapUser('mho', { _id: 'u2', category: 'patient', isStaff: true }).isStaff).toBe(true);
    expect(mapUser('mho', { _id: 'u3', category: 'patient' }).isStaff).toBeUndefined();
  });
});
