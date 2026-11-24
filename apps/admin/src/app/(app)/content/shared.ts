export interface PageSummary {
  id: string;
  key: string;
  lang: string;
  kind: 'legal' | 'page';
  version: number;
  live: { title: string; version: number; publishedAt: string; publishedBy: string; approvedBy: string | null; body?: unknown[] } | null;
  draft: {
    state: 'editing' | 'review';
    basedOn: number | null;
    updatedBy: string;
    updatedAt: string;
    reviewRequestedBy: string | null;
    title?: string;
    body?: unknown[];
  } | null;
  updatedAt: string;
}
export interface Revision {
  version: number;
  title: string;
  editedBy: string;
  reviewRequestedBy: string | null;
  publishedBy: string;
  publishedAt: string;
}
export const KEY_LABEL: Record<string, string> = {
  privacy: 'Privacy policy',
  terms: 'Terms and conditions',
  gdpr: 'GDPR and your rights',
  cookies: 'Cookie policy',
};
