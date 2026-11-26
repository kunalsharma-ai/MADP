/**
 * Member health score (0 to 100), the same on T2O, MFR, MHO and any added panel. It uses only what the panel's member
 * list already shows, so nothing extra is read, and every point can be explained:
 *
 *   activity   40  last activity within 7 days 40, 30 days 30, 60 days 20, 90 days 10, older or never 0
 *   quality    30  the panel's quality score (0 to 100) scaled to 30
 *   verified   15  e-mail verified 10, phone verified 5
 *   standing   15  an active member 15; suspended, banned or archived 0
 *
 * A suspended or banned member is "critical" whatever the rest says. Health facts are never part of it.
 */
export interface MemberHealthInput {
  status: string;
  qualityScore?: number | null;
  emailVerified?: string | null;
  phoneVerified?: string | null;
  lastActivityAt?: string | null;
  signedUpAt?: string | null;
}
export type MemberHealthBand = 'healthy' | 'ok' | 'at_risk' | 'critical';
export interface MemberHealth {
  score: number;
  band: MemberHealthBand;
  parts: { key: 'activity' | 'quality' | 'verified' | 'standing'; label: string; points: number; max: number; why: string }[];
}

const DAY = 86_400_000;
export const HEALTH_BANDS: Record<MemberHealthBand, { label: string; min: number; color: string }> = {
  healthy: { label: 'Healthy', min: 75, color: '#16a34a' },
  ok: { label: 'Okay', min: 50, color: '#d97706' },
  at_risk: { label: 'At risk', min: 25, color: '#ea580c' },
  critical: { label: 'Critical', min: 0, color: '#dc2626' },
};

export function memberHealth(m: MemberHealthInput, now: Date = new Date()): MemberHealth {
  // a member who never did anything counts from sign-up; a missing date counts as long ago
  const last = Date.parse(m.lastActivityAt ?? '') || Date.parse(m.signedUpAt ?? '') || 0;
  const days = last ? Math.max(0, Math.floor((now.getTime() - last) / DAY)) : Infinity;
  const activity = days <= 7 ? 40 : days <= 30 ? 30 : days <= 60 ? 20 : days <= 90 ? 10 : 0;
  const q = Math.min(100, Math.max(0, Number(m.qualityScore ?? 100)));
  const quality = Math.round((q / 100) * 30);
  const email = m.emailVerified === 'verified' ? 10 : 0;
  const phone = m.phoneVerified === 'verified' ? 5 : 0;
  const active = m.status === 'active';
  const standing = active ? 15 : 0;
  const score = activity + quality + email + phone + standing;
  const blocked = m.status === 'suspended' || m.status === 'banned';
  const band: MemberHealthBand = blocked
    ? 'critical'
    : score >= 75
      ? 'healthy'
      : score >= 50
        ? 'ok'
        : score >= 25
          ? 'at_risk'
          : 'critical';
  return {
    score,
    band,
    parts: [
      {
        key: 'activity',
        label: 'Recent activity',
        points: activity,
        max: 40,
        why: days === Infinity ? 'No activity on record' : days === 0 ? 'Active today' : `Last active ${days} day${days === 1 ? '' : 's'} ago`,
      },
      { key: 'quality', label: 'Answer quality', points: quality, max: 30, why: `Quality score ${q}` },
      {
        key: 'verified',
        label: 'Verified contact',
        points: email + phone,
        max: 15,
        why: [email ? 'e-mail verified' : 'e-mail not verified', phone ? 'phone verified' : 'phone not verified'].join(', '),
      },
      { key: 'standing', label: 'Account standing', points: standing, max: 15, why: active ? 'Active' : `Status: ${m.status}` },
    ],
  };
}
