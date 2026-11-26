import { describe, expect, it } from 'vitest';
import { memberHealth } from './member-health.js';

const now = new Date('2026-11-26T12:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('memberHealth', () => {
  it('gives full marks to an active, verified, recent, high-quality member', () => {
    const h = memberHealth({ status: 'active', qualityScore: 100, emailVerified: 'verified', phoneVerified: 'verified', lastActivityAt: ago(2) }, now);
    expect(h).toMatchObject({ score: 100, band: 'healthy' });
    expect(h.parts.reduce((n, p) => n + p.points, 0)).toBe(100);
  });

  it('drops with inactivity and falls back to the sign-up date when there is no activity', () => {
    const base = { status: 'active', qualityScore: 100, emailVerified: 'verified', phoneVerified: 'unverified' };
    expect(memberHealth({ ...base, lastActivityAt: ago(20) }, now).score).toBe(85);
    expect(memberHealth({ ...base, lastActivityAt: ago(75) }, now).score).toBe(65);
    expect(memberHealth({ ...base, lastActivityAt: null, signedUpAt: ago(200) }, now)).toMatchObject({ score: 55, band: 'ok' });
    expect(memberHealth({ ...base, lastActivityAt: null, signedUpAt: null }, now).parts[0]!.why).toBe('No activity on record');
  });

  it('marks suspended or banned members critical, and archived ones lose standing', () => {
    const base = { qualityScore: 100, emailVerified: 'verified', phoneVerified: 'verified', lastActivityAt: ago(1) };
    expect(memberHealth({ ...base, status: 'suspended' }, now).band).toBe('critical');
    expect(memberHealth({ ...base, status: 'banned' }, now).band).toBe('critical');
    expect(memberHealth({ ...base, status: 'archived' }, now)).toMatchObject({ score: 85, band: 'healthy' });
  });

  it('keeps the quality score in range and treats a missing one as 100', () => {
    expect(memberHealth({ status: 'active', qualityScore: 180, lastActivityAt: ago(1) }, now).parts[1]!.points).toBe(30);
    expect(memberHealth({ status: 'active', qualityScore: -5, lastActivityAt: ago(1) }, now).parts[1]!.points).toBe(0);
    expect(memberHealth({ status: 'active', lastActivityAt: ago(1) }, now).parts[1]!.points).toBe(30);
  });
});
