import { z } from 'zod';
import { PanelCode } from './panels.js';

/** Missing attributes and freshness (screen 13). Default window: the 6-month recheck in the super admin spec. */
export const FreshnessQuery = z.object({
  panel: PanelCode.optional(),
  staleDays: z.coerce.number().int().min(7).max(730).default(180),
});
export type FreshnessQuery = z.infer<typeof FreshnessQuery>;
