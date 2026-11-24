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
}

export const STATUS_TONE = {
  active: 'teal',
  suspended: 'warn',
  banned: 'danger',
  archived: 'neutral',
} as const;
