/**
 * A transparent contact-load indicator, not a validated scientific score, and not a fraud or quality signal.
 * Each factor is shown with its points so a reviewer can see why a member is in a band.
 */
export interface FatigueInput {
  messages30d: number;
  unanswered30d: number;
  complaints: number;
  optedOut: boolean;
}
export const FATIGUE_WEIGHTS = { messages30d: 10, unanswered30d: 5, complaints: 30 } as const;

export function fatigueScore(i: FatigueInput, bands: { high: number; medium: number }) {
  const factors = [
    { factor: 'Messages in the last 30 days', value: i.messages30d, points: i.messages30d * FATIGUE_WEIGHTS.messages30d },
    {
      factor: 'Messages with no open or click (last 30 days)',
      value: i.unanswered30d,
      points: i.unanswered30d * FATIGUE_WEIGHTS.unanswered30d,
    },
    { factor: 'Complaints', value: i.complaints, points: i.complaints * FATIGUE_WEIGHTS.complaints },
  ];
  const score = i.optedOut ? null : factors.reduce((n, f) => n + f.points, 0);
  const band = i.optedOut ? 'opted_out' : score! >= bands.high ? 'high' : score! >= bands.medium ? 'medium' : 'low';
  return { score, band, factors, bands };
}
