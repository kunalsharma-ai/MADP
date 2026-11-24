import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * Verification and data quality (screen 8). Panels report e-mail and phone verification and a quality score; those
 * stay labelled "source-reported". MADP adds independent verification evidence (a licence or identity check that a
 * reviewer carried out), recorded by one admin and decided by another. Evidence never holds personal data: the
 * reference points to where the proof is kept (a ticket or registry lookup id).
 */
export const VERIFICATION_CLAIMS = ['identity', 'age', 'hcp_licence', 'employment'] as const;
export const VerificationClaim = z.enum(VERIFICATION_CLAIMS);
export type VerificationClaim = z.infer<typeof VerificationClaim>;

export const VERIFICATION_METHODS = [
  'document_check',
  'registry_lookup',
  'work_email',
  'video_call',
  'third_party_service',
] as const;
export const VerificationMethod = z.enum(VERIFICATION_METHODS);

export const EVIDENCE_STATUSES = ['pending', 'verified', 'rejected', 'revoked'] as const;
export const EvidenceStatus = z.enum(EVIDENCE_STATUSES);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

export const EvidenceCreate = z.object({
  personId: z.string().uuid(),
  /** The brand whose member made the claim. The person must be a member of it. */
  panel: PanelCode,
  claim: VerificationClaim,
  method: VerificationMethod,
  /** Where the proof is kept, e.g. "Ticket 4411" or a registry lookup id. No personal data. */
  reference: z.string().trim().min(3).max(200),
  /** When the proof runs out, e.g. a licence's renewal date (YYYY-MM-DD). */
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type EvidenceCreate = z.infer<typeof EvidenceCreate>;

export const EvidenceDecision = z.object({
  decision: z.enum(['verified', 'rejected']),
  note: z.string().trim().min(3).max(500),
});
export type EvidenceDecision = z.infer<typeof EvidenceDecision>;

export const EvidenceRevoke = z.object({ note: z.string().trim().min(3).max(500) });
export type EvidenceRevoke = z.infer<typeof EvidenceRevoke>;

export const EvidenceQuery = z.object({
  panel: PanelCode.optional(),
  status: EvidenceStatus.optional(),
  personId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type EvidenceQuery = z.infer<typeof EvidenceQuery>;

/**
 * Data quality checks MADP runs on its copy of each panel's member records. Thresholds follow the panel audits:
 * T2O and MFR accept ages 13 to 120 and start every member at a quality score of 100 (maximum 200).
 */
export const QUALITY_CHECKS = [
  'missing_country',
  'missing_birth_year',
  'implausible_age',
  'missing_timezone',
  'unknown_timezone',
  'no_email',
  'email_rejected',
  'shared_email_in_panel',
  'quality_below_default',
  'no_quality_score',
] as const;
export const QualityCheck = z.enum(QUALITY_CHECKS);
export type QualityCheck = z.infer<typeof QualityCheck>;

export const QualityQuery = z.object({ panel: PanelCode.optional() });
export type QualityQuery = z.infer<typeof QualityQuery>;

export const QualityDrillQuery = z.object({
  panel: PanelCode,
  check: QualityCheck,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type QualityDrillQuery = z.infer<typeof QualityDrillQuery>;
