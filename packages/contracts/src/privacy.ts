import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * Privacy requests (spec §11, screen 15). Panels own the member record: MADP erases its own copy, keeps the member
 * out of later syncs, and tracks the panel's deletion until the panel's deletions feed confirms it. Counsel decides
 * which law applies; MADP records the jurisdiction and the due date it was given.
 */
export const PRIVACY_KINDS = ['access', 'correction', 'deletion', 'restriction'] as const;
export const PrivacyKind = z.enum(PRIVACY_KINDS);
export type PrivacyKind = z.infer<typeof PrivacyKind>;

export const PRIVACY_STATUSES = ['received', 'verified', 'awaiting_panel', 'completed', 'rejected'] as const;

export const PrivacyRequestCreate = z.object({
  personId: z.string().uuid(),
  kind: PrivacyKind,
  /** Defaults to every panel the person is a member of. */
  panels: z.array(PanelCode).min(1).optional(),
  /** Where it came from, e.g. a ticket number. No personal data. */
  reference: z.string().trim().min(3).max(200),
  jurisdiction: z.string().trim().max(40).optional(),
  /** Days to respond, as counsel set for the jurisdiction. */
  dueInDays: z.number().int().min(1).max(90).default(30),
});
export type PrivacyRequestCreate = z.infer<typeof PrivacyRequestCreate>;

export const PrivacyStep = z.object({ note: z.string().trim().min(3).max(500) });
export type PrivacyStep = z.infer<typeof PrivacyStep>;

export const PrivacyQuery = z.object({
  status: z.enum(PRIVACY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type PrivacyQuery = z.infer<typeof PrivacyQuery>;
