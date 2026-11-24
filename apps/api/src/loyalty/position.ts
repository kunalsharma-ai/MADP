import type { SourceResponse, SourceReward } from '@madp/contracts';

export type Bucket = 'pending' | 'approved' | 'reversed' | 'redeemed';
export const ACTIVE: Bucket[] = ['pending', 'approved', 'redeemed'];

/** Where one source row stands: the bucket holding its points, or none. */
export interface Position {
  bucket: Bucket | null;
  points: number;
}

/** A source row's current position, from the sum of its ledger lines per bucket. */
export function positionOf(sums: Partial<Record<Bucket, number>>): Position {
  for (const b of ACTIVE) if ((sums[b] ?? 0) !== 0) return { bucket: b, points: sums[b]! };
  if ((sums.reversed ?? 0) !== 0) return { bucket: 'reversed', points: sums.reversed! };
  return { bucket: null, points: 0 };
}

/** Panel reward statuses and the bucket each mirrors to. Anything else is held as pending and reported. */
const REWARD_STATUS: Record<string, Bucket> = {
  credited: 'approved',
  approved: 'approved',
  pending: 'pending',
  reversed: 'reversed',
  debited: 'reversed',
  cancelled: 'reversed',
  revoked: 'reversed',
  redeemed: 'redeemed',
};

export function rewardTarget(r: SourceReward): Position & { unknownStatus: boolean } {
  const bucket = REWARD_STATUS[r.status];
  if (r.points <= 0) return { bucket: null, points: 0, unknownStatus: false };
  return { bucket: bucket ?? 'pending', points: r.points, unknownStatus: !bucket };
}

/**
 * A survey complete carries points on the panel, but MADP does not treat a complete on its own as earned: the
 * points stay pending until someone records the client's approval. An approved complete stays approved while the
 * panel keeps it complete with the same points. Anything else (terminate, deleted, no points) holds nothing.
 */
export function responseTarget(r: SourceResponse, current: Position): Position {
  if (r.isDeleted || r.status !== 'complete' || r.points <= 0) return { bucket: null, points: 0 };
  if (current.bucket === 'approved' && current.points === r.points) return current;
  return { bucket: 'pending', points: r.points };
}

/**
 * The ledger lines that move a row from `from` to `to`. Leaving an active bucket takes its points out; arriving
 * in one puts the new points in. Losing an active position without a new one is a reversal of those points.
 */
export function moves(from: Position, to: Position): { bucket: Bucket; points: number }[] {
  if (from.bucket === to.bucket && from.points === to.points) return [];
  const out: { bucket: Bucket; points: number }[] = [];
  const fromActive = from.bucket !== null && ACTIVE.includes(from.bucket);
  const toActive = to.bucket !== null && ACTIVE.includes(to.bucket);
  if (from.bucket === 'reversed' && (to.bucket === 'reversed' || to.bucket === null)) return [];
  if (fromActive) out.push({ bucket: from.bucket!, points: -from.points });
  if (toActive) out.push({ bucket: to.bucket!, points: to.points });
  else if (to.bucket === 'reversed') out.push({ bucket: 'reversed', points: fromActive ? from.points : to.points });
  else if (fromActive) out.push({ bucket: 'reversed', points: from.points });
  return out;
}
