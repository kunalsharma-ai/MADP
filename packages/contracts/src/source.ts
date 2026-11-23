import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * Normalised *source* records produced by connectors. They keep the source identifiers exactly as the
 * panel stores them so provenance survives every later transformation. Nothing here is canonical yet.
 */

export const SourceQuestion = z.object({
  panel: PanelCode,
  /** `Question.name` in the panel database; unique per (category, origin). */
  sourceQuestionId: z.string().min(1),
  label: z.string(),
  /** Free-text in the source (no enum enforced there), e.g. "select", "multiselect", "radio". */
  type: z.string().nullable(),
  /** `Question.parent`: name of the question whose answer drives this one's options (cascades). */
  parent: z.string().nullable(),
  /** Source `Question.category` array, raw values (e.g. "b2c", "healthcare professional"). */
  categories: z.array(z.string()),
  isRequired: z.boolean().nullable(),
  hasOthers: z.boolean().nullable(),
  hasNone: z.boolean().nullable(),
  maxSelections: z.number().int().nullable(),
  sourceUpdatedAt: z.string().datetime().nullable(),
});
export type SourceQuestion = z.infer<typeof SourceQuestion>;

export const SourceOption = z.object({
  panel: PanelCode,
  sourceQuestionId: z.string().min(1),
  value: z.string(),
  label: z.string(),
  /** `Option.parentValue`: option is only offered when the parent question's answer is one of these. */
  parentValues: z.array(z.string()),
  isExclusive: z.boolean(),
});
export type SourceOption = z.infer<typeof SourceOption>;

/** `Profile` documents: a named questionnaire whose `pages` are arrays of question names. */
export const SourceQuestionnaire = z.object({
  panel: PanelCode,
  slug: z.string(),
  name: z.string(),
  sourceCategory: z.string(),
  /** Each page: [pageTitle, ...questionNames] exactly as stored (first entry is the page title). */
  pages: z.array(z.array(z.string())),
  points: z.number().nullable(),
});
export type SourceQuestionnaire = z.infer<typeof SourceQuestionnaire>;

export const VerificationState = z.enum(['unverified', 'verified', 'rejected']);

/**
 * A consent state read from the source member record. Evidence holds the source field and value only: never IP
 * addresses, signatures or guardian contact details.
 */
export const SourceConsent = z.object({
  purpose: z.enum(['guardian_consent', 'terms', 'push_notifications', 'video_sharing', 'gps_sharing']),
  status: z.enum(['granted', 'denied', 'withdrawn', 'unknown']),
  capturedAt: z.string().datetime().nullable(),
  evidence: z.object({ field: z.string(), value: z.string().nullable(), version: z.string().nullable() }),
});
export type SourceConsent = z.infer<typeof SourceConsent>;

export const SourceRespondent = z.object({
  panel: PanelCode,
  /** Source `User._id`. Never shown in full to non-privileged roles. */
  sourceMemberId: z.string().min(1),
  /** Source `User.respondentID` when present. */
  sourceRespondentRef: z.string().nullable(),
  sourceCategory: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  gender: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  country: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string().nullable(),
  emailVerification: VerificationState,
  phoneVerification: VerificationState,
  qualityScore: z.number().nullable(),
  isActive: z.boolean(),
  sourceCreatedAt: z.string().datetime().nullable(),
  sourceUpdatedAt: z.string().datetime().nullable(),
  consents: z.array(SourceConsent).default([]),
});
export type SourceRespondent = z.infer<typeof SourceRespondent>;

export const SourceAnswer = z.object({
  panel: PanelCode,
  sourceMemberId: z.string().min(1),
  sourceQuestionId: z.string().min(1),
  /** Source `Answer.answer` is always a string array (single answers are a 1-element array). */
  values: z.array(z.string()),
  sourceUpdatedAt: z.string().datetime().nullable(),
});
export type SourceAnswer = z.infer<typeof SourceAnswer>;

/** A page of source records with an opaque resume cursor. */
export interface SourcePage<T> {
  items: T[];
  nextCursor: string | null;
}
