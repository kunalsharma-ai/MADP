export interface SurveyRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  source: string;
  status: 'draft' | 'active' | 'paused' | 'closed';
  points: number;
  loi: number;
  link: string;
  summary: string;
  minQualityScore: number | null;
  premium: { enabled: boolean; industries: string[]; seniority: string[] };
  batchSize: number | null;
  createdAt: string;
  counts?: Record<string, number>;
}
export const SURVEY_TONE = { draft: 'neutral', active: 'teal', paused: 'warn', closed: 'danger' } as const;
