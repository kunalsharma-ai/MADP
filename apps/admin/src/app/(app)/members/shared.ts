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
  /** MADP's own admin tags on this member. */
  tags?: string[];
  qualityScore: number;
  emailVerified: string;
  phoneVerified?: string;
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

const TAG_TINTS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#0ea5e9', '#a855f7', '#22c55e', '#f43f5e'];
/** The same tag always gets the same colour. */
export function tagTint(tag: string): string {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAG_TINTS[h % TAG_TINTS.length]!;
}
