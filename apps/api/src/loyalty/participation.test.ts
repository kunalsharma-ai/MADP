import { describe, expect, it } from 'vitest';
import { engagementOf } from './participation.service.js';

const now = Date.parse('2026-11-26T12:00:00Z');
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const base = { attempts: 0, completes: 0, terminates: 0, ended: 0, points: 0, last90Days: 0, lastActivity: null as string | null };

describe('engagementOf', () => {
  it('scores a member who never took a survey as inactive', () => {
    const e = engagementOf('t2o', base, now);
    expect(e.score).toBe(0);
    expect(e.band).toBe('inactive');
    expect(e.completeRate).toBeNull();
  });

  it('rewards recent activity, a high complete rate and many completes', () => {
    const e = engagementOf('mfr', { ...base, attempts: 12, completes: 10, terminates: 2, ended: 12, points: 900, last90Days: 12, lastActivity: daysAgo(3) }, now);
    expect(e.completeRate).toBeCloseTo(10 / 12);
    expect(e.score).toBe(Math.round(50 + 30 * (10 / 12) + 20));
    expect(e.band).toBe('very active');
  });

  it('cools down a member whose last survey was long ago', () => {
    const e = engagementOf('mho', { ...base, attempts: 4, completes: 2, terminates: 2, ended: 4, last90Days: 0, lastActivity: daysAgo(150) }, now);
    expect(e.score).toBe(Math.round(50 * 0.2 + 30 * 0.5 + 20 * 0.2));
    expect(e.band).toBe('cooling');
  });

  it('leaves invited-only attempts out of the complete rate', () => {
    const e = engagementOf('t2o', { ...base, attempts: 3, last90Days: 3, lastActivity: daysAgo(1) }, now);
    expect(e.completeRate).toBeNull();
    expect(e.score).toBe(50);
  });
});
