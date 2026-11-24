import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * Loyalty (Milestone 5). Each panel's wallet stays the panel's: MADP keeps a read-only, append-only mirror per
 * panel membership and never adds balances across panels. Survey completes stay pending until the client's
 * approval is recorded here.
 */
export const LOYALTY_BUCKETS = ['pending', 'approved', 'reversed', 'redeemed'] as const;

export const LoyaltyPanelQuery = z.object({ panel: PanelCode.optional() });
export type LoyaltyPanelQuery = z.infer<typeof LoyaltyPanelQuery>;

export const SurveyApproval = z.object({
  surveySlug: z.string().trim().min(1).max(200),
  /** Where the approval came from (the client's sign-off), kept on every ledger line it writes. */
  note: z.string().trim().min(3).max(1000),
});
export type SurveyApproval = z.infer<typeof SurveyApproval>;

export const ReconcileRequest = z.object({ repair: z.boolean().default(false) });
export type ReconcileRequest = z.infer<typeof ReconcileRequest>;
