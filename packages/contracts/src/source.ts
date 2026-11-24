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
  purpose: z.enum(['guardian_consent', 'terms', 'push_notifications', 'video_sharing', 'gps_sharing', 'email_marketing']),
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
  /** The panel soft-deleted the member (`isDeleted`). Only the changes feed reports it; treated as a deletion. */
  isDeleted: z.boolean().optional(),
  /** An admin or integration account on the panel (T2O `isStaff`, turn2opinion#21). Never imported as a member. */
  isStaff: z.boolean().optional(),
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

/**
 * A page of a panel's changed-since feed (T2O `GET /api/v1/changes/*`). `cursor` is where the next call continues
 * (unchanged when nothing new was found); `more` says whether another page is ready now.
 */
export interface SourceChangePage<T> {
  items: T[];
  cursor: string | null;
  more: boolean;
}

/**
 * Something the panel removed for good. `member`: the member record was deleted. `answers`: all of the member's
 * profile answers were removed (T2O `POST /user/refresh`). Holds the source member id only.
 */
export const SourceDeletion = z.object({
  panel: PanelCode,
  sourceMemberId: z.string().min(1),
  kind: z.enum(['member', 'answers']),
  at: z.string().datetime().nullable(),
});
export type SourceDeletion = z.infer<typeof SourceDeletion>;

/** Where a changes-feed read starts: after `cursor`, or (with no cursor) at `since`, or from the beginning. */
export interface ChangeQuery {
  cursor: string | null;
  since?: string | null;
  limit: number;
}

/**
 * A reward row from a panel's wallet (T2O `Rewards`, `GET /api/v1/changes/rewards`, turn2opinion#24). The panel
 * owns the wallet; MADP keeps a read-only mirror. `status` is the panel's own value (`credited` today).
 */
export const SourceReward = z.object({
  panel: PanelCode,
  sourceRewardId: z.string().min(1),
  sourceMemberId: z.string().min(1),
  category: z.string(),
  points: z.number().int(),
  title: z.string().nullable(),
  status: z.string(),
  /** The profile slug, for profile-completion credits only. */
  profileSlug: z.string().nullable(),
  sourceCreatedAt: z.string().datetime().nullable(),
  sourceUpdatedAt: z.string().datetime().nullable(),
});
export type SourceReward = z.infer<typeof SourceReward>;

/**
 * A survey response (T2O `Response`, `GET /api/v1/changes/responses`, turn2opinion#24): who took which survey,
 * the outcome and the points it carries. The panel adds a complete response's points to the member's balance.
 */
export const SourceResponse = z.object({
  panel: PanelCode,
  sourceResponseId: z.string().min(1),
  sourceMemberId: z.string().min(1),
  surveySlug: z.string().nullable(),
  status: z.string(),
  points: z.number().int(),
  loi: z.number(),
  source: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  isDeleted: z.boolean(),
  sourceUpdatedAt: z.string().datetime().nullable(),
});
export type SourceResponse = z.infer<typeof SourceResponse>;
