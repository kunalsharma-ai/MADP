import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * AI insights and reviewable recommendations (screen 34). Today every insight comes from a fixed, documented rule
 * over MADP's own counts; no AI model is called, and none will be without the owner's approval. Each insight is
 * per panel, holds counts only, and waits for a person to accept or dismiss it. MADP never acts on one by itself.
 */
export const INSIGHT_RULES = [
  'low_reachability',
  'profiles_due_for_check',
  'never_profiled',
  'quality_below_default',
  'shared_emails',
  'identity_review_backlog',
  'pending_mappings',
  'pending_survey_points',
  'sync_stale',
  'sync_failures',
  'privacy_overdue',
  'evidence_expiring',
] as const;
export const InsightRule = z.enum(INSIGHT_RULES);
export type InsightRule = z.infer<typeof InsightRule>;

export const INSIGHT_STATUSES = ['open', 'accepted', 'dismissed', 'resolved'] as const;
export const InsightStatus = z.enum(INSIGHT_STATUSES);

export const InsightQuery = z.object({
  panel: PanelCode.optional(),
  status: InsightStatus.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type InsightQuery = z.infer<typeof InsightQuery>;

export const InsightDecision = z.object({
  decision: z.enum(['accepted', 'dismissed']),
  note: z.string().trim().min(3).max(500),
});
export type InsightDecision = z.infer<typeof InsightDecision>;
