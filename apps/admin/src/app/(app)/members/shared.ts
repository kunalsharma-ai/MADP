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
  /** From the panel since MFR#103; older panel builds leave these out. */
  gender?: string | null;
  age?: number | null;
  /** The Type column: question-bank answers for this member's segment (designation, HCP type, condition...). */
  typeValues?: { label: string; values: string[] }[];
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

export const GENDER_TONE: Record<string, string> = { Female: '#ec4899', Male: '#3b82f6', Other: '#a855f7' };

/** One panel category value for the Segment filter, with the MADP segments it joins. */
export interface PanelCategory {
  value: string;
  segments: string[];
  minor: boolean;
}
