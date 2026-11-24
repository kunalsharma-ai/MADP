import { describe, expect, it } from 'vitest';
import type { SourceResponse, SourceReward } from '@madp/contracts';
import { moves, positionOf, responseTarget, rewardTarget } from './position.js';

const reward = (o: Partial<SourceReward> = {}): SourceReward => ({
  panel: 't2o', sourceRewardId: 'r1', sourceMemberId: 'm1', category: 'profile', points: 50, title: null,
  status: 'credited', profileSlug: 'basic', sourceCreatedAt: null, sourceUpdatedAt: null, ...o,
});
const response = (o: Partial<SourceResponse> = {}): SourceResponse => ({
  panel: 't2o', sourceResponseId: 's1', sourceMemberId: 'm1', surveySlug: 'x', status: 'complete', points: 100, loi: 10,
  source: null, startedAt: null, endedAt: null, isDeleted: false, sourceUpdatedAt: null, ...o,
});
const none = { bucket: null, points: 0 } as const;

describe('ledger positions', () => {
  it('reads the position from bucket sums', () => {
    expect(positionOf({})).toEqual(none);
    expect(positionOf({ approved: 0, reversed: 50 })).toEqual({ bucket: 'reversed', points: 50 });
    expect(positionOf({ pending: 0, approved: 120, reversed: 50 })).toEqual({ bucket: 'approved', points: 120 });
  });

  it('mirrors credited rewards as approved, holds unknown statuses as pending', () => {
    expect(rewardTarget(reward())).toMatchObject({ bucket: 'approved', points: 50, unknownStatus: false });
    expect(rewardTarget(reward({ status: 'debited' }))).toMatchObject({ bucket: 'reversed' });
    expect(rewardTarget(reward({ status: 'on_hold' }))).toMatchObject({ bucket: 'pending', unknownStatus: true });
    expect(rewardTarget(reward({ points: 0 }))).toMatchObject({ bucket: null });
  });

  it('never treats a survey complete as earned on its own', () => {
    expect(responseTarget(response(), none)).toEqual({ bucket: 'pending', points: 100 });
    expect(responseTarget(response(), { bucket: 'approved', points: 100 })).toEqual({ bucket: 'approved', points: 100 });
    // Points changed after approval: back to pending for a fresh approval.
    expect(responseTarget(response({ points: 150 }), { bucket: 'approved', points: 100 })).toEqual({ bucket: 'pending', points: 150 });
    for (const o of [{ status: 'terminate' }, { isDeleted: true }, { points: 0 }, { status: 'invited' }])
      expect(responseTarget(response(o), none)).toEqual(none);
  });

  it('moves points between buckets with lines that sum to the change', () => {
    expect(moves(none, { bucket: 'approved', points: 50 })).toEqual([{ bucket: 'approved', points: 50 }]);
    expect(moves({ bucket: 'approved', points: 50 }, { bucket: 'approved', points: 50 })).toEqual([]);
    expect(moves({ bucket: 'approved', points: 50 }, { bucket: 'reversed', points: 50 })).toEqual([
      { bucket: 'approved', points: -50 },
      { bucket: 'reversed', points: 50 },
    ]);
    expect(moves({ bucket: 'pending', points: 100 }, none)).toEqual([
      { bucket: 'pending', points: -100 },
      { bucket: 'reversed', points: 100 },
    ]);
    expect(moves({ bucket: 'pending', points: 100 }, { bucket: 'pending', points: 120 })).toEqual([
      { bucket: 'pending', points: -100 },
      { bucket: 'pending', points: 120 },
    ]);
    expect(moves(none, { bucket: 'reversed', points: 50 })).toEqual([{ bucket: 'reversed', points: 50 }]);
    expect(moves({ bucket: 'reversed', points: 50 }, { bucket: 'reversed', points: 50 })).toEqual([]);
    expect(moves({ bucket: 'reversed', points: 50 }, none)).toEqual([]);
    expect(moves({ bucket: 'reversed', points: 50 }, { bucket: 'approved', points: 50 })).toEqual([{ bucket: 'approved', points: 50 }]);
  });
});
