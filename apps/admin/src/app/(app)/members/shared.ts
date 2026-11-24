export interface MemberRow {
  id: string;
  memberId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  category: string;
  segment: string;
  status: 'active' | 'suspended' | 'banned' | 'archived';
  country: string | null;
  birthYear: number | null;
  qualityScore: number;
  emailVerified: string;
  signedUpAt: string;
  lastActivityAt: string | null;
  /** Marketing e-mail opt-in from the panel (MFR#54). Older panel builds leave it out: show it as not asked. */
  marketingOptIn?: { granted: boolean; at: string | null; source: string | null; asked: boolean };
}

/** "Send me news and offers": only an explicit tick counts as marketing consent. */
export function marketingLabel(m?: MemberRow['marketingOptIn']): { text: string; tone: 'teal' | 'neutral' | 'warn' } {
  if (!m?.asked) return { text: 'Not asked', tone: 'neutral' };
  if (m.granted) return { text: 'Opted in', tone: 'teal' };
  return { text: m.source === 'signup' ? 'Declined' : 'Withdrawn', tone: 'warn' };
}

export const STATUS_TONE = {
  active: 'teal',
  suspended: 'warn',
  banned: 'danger',
  archived: 'neutral',
} as const;
