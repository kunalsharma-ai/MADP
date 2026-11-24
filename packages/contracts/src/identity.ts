import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * Cross-panel identity review. A match between panels is only a candidate: a reviewer approves (merge) or rejects
 * it, and any link, including an automatic one, can be undone (unmerge). Panel memberships, consents, rewards and
 * communications always stay per panel; only the person they belong to changes.
 */
export const IdentityCandidateQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  panel: PanelCode.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type IdentityCandidateQuery = z.infer<typeof IdentityCandidateQuery>;

export const IdentityDecision = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
});
export type IdentityDecision = z.infer<typeof IdentityDecision>;

export const IdentityUnlink = z.object({
  /** Why the link was wrong. Required: it is kept with the unmerge event. */
  reason: z.string().trim().min(3).max(500),
});
export type IdentityUnlink = z.infer<typeof IdentityUnlink>;

/** Person fields chosen from the linked source identities by the precedence rule. */
export const PERSON_FIELDS = ['country', 'state', 'city', 'gender', 'birthYear'] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];

/**
 * Source precedence, per field: identities whose panel membership was deleted never count; then an identity with a
 * verified e-mail wins over an unverified one; then the most recently updated at the source; then the one MADP saw
 * first. No panel outranks another (all three are equal), so the rule looks only at the record.
 */
export const SOURCE_PRECEDENCE = [
  'membership not deleted',
  'verified e-mail first',
  'latest source update first',
  'first seen by MADP first',
] as const;
