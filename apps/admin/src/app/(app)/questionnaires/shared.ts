import type { BuilderSource, DraftProblem, DraftSpec, DraftStatus } from '@madp/contracts';

export interface DraftSummary {
  id: string;
  panel: 't2o' | 'mfr' | 'mho';
  dataMode: 'demo' | 'live';
  category: string;
  slug: string;
  name: string;
  note: string | null;
  status: DraftStatus;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  appliedBy: string | null;
  appliedAt: string | null;
  updatedAt: string;
  createdAt: string;
  errors: number;
  warnings: number;
  changes: number;
}
export interface DraftDetail extends DraftSummary {
  base: BuilderSource;
  spec: DraftSpec;
  problems: DraftProblem[];
  writes: { kind: string; target: string; summary: string }[];
  applyResult: {
    steps: { kind: string; target: string; ok: boolean; error?: string }[];
    panelVersion: number | null;
    versionError: string | null;
    at: string;
  } | null;
}

export const STATUS_TONE = {
  draft: 'neutral',
  review: 'accent',
  approved: 'teal',
  rejected: 'danger',
  applied: 'teal',
  discarded: 'neutral',
} as const;
export const STATUS_LABEL: Record<DraftStatus, string> = {
  draft: 'Draft',
  review: 'Waiting for review',
  approved: 'Approved, not applied',
  rejected: 'Rejected',
  applied: 'Applied to the panel',
  discarded: 'Discarded',
};
