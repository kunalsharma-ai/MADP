import { z } from 'zod';

/**
 * Super admin console, modules 1 to 4 (members, question bank, profiles). MADP checks the admin's permission and
 * brand, writes the audit entry, then calls the panel backend's signed /api/admin/v1 for that brand.
 */
const Reason = z.string().trim().min(5).max(500);
const ObjectId = z.string().regex(/^[a-f0-9]{24}$/i, 'a member id');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const MemberStatus = z.enum(['active', 'suspended', 'banned', 'archived']);
export type MemberStatus = z.infer<typeof MemberStatus>;

export const MemberSearch = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  segment: z.enum(['teen']).optional(),
  status: MemberStatus.optional(),
  country: z
    .string()
    .trim()
    .regex(/^[a-zA-Z]{2}$/)
    .optional(),
  from: day.optional(),
  to: day.optional(),
  qualityMin: z.coerce.number().int().min(0).max(200).optional(),
  qualityMax: z.coerce.number().int().min(0).max(200).optional(),
  inactiveSince: day.optional(),
  dueBefore: day.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type MemberSearch = z.infer<typeof MemberSearch>;

const Verification = z.enum(['unverified', 'verified', 'rejected']);
export const MemberUpdate = z
  .object({
    'name.first': z.string().trim().min(1).max(80).optional(),
    'name.middle': z.string().trim().max(80).optional(),
    'name.last': z.string().trim().max(80).optional(),
    gender: z.enum(['Male', 'Female', 'Other']).optional(),
    timezone: z
      .string()
      .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/)
      .optional(),
    'isVerified.email': Verification.optional(),
    'isVerified.phone': Verification.optional(),
    'isVerified.video': Verification.optional(),
    'isVerified.inPersonVisit': Verification.optional(),
    reason: Reason,
  })
  .strict();
export type MemberUpdate = z.infer<typeof MemberUpdate>;

export const MemberAction = z.enum(['suspend', 'ban', 'reactivate', 'archive', 'restore']);
export const MemberStatusChange = z.object({ action: MemberAction, reason: Reason });
export type MemberStatusChange = z.infer<typeof MemberStatusChange>;

export const MemberSegmentChange = z.object({ category: z.string().trim().min(1).max(40), reason: Reason });
export type MemberSegmentChange = z.infer<typeof MemberSegmentChange>;

export const UnmaskField = z.enum(['email', 'phone', 'dob', 'address', 'payment', 'guardianEmail']);
export const MemberUnmask = z.object({ fields: z.array(UnmaskField).min(1).max(6), reason: Reason });
export type MemberUnmask = z.infer<typeof MemberUnmask>;

export const ArchiveRun = z.object({
  months: z.number().int().min(1).max(60).optional(),
  dryRun: z.boolean().default(true),
  reason: Reason.optional(),
});
export type ArchiveRun = z.infer<typeof ArchiveRun>;

export const MemberRestore = z.object({ ids: z.array(ObjectId).min(1).max(1000), reason: Reason });
export type MemberRestore = z.infer<typeof MemberRestore>;

// ---- question bank -------------------------------------------------------------------------------------------------
const QuestionKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{0,79}$/, 'lower case key');
const QuestionFields = {
  label: z.string().trim().min(1).max(500).optional(),
  type: z.string().trim().min(1).max(40).optional(),
  parent: z.string().trim().max(80).optional(),
  description: z.string().max(2000).optional(),
  adminLabel: z.string().max(200).optional(),
  category: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(10).optional(),
  isMoney: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  isEditable: z.boolean().optional(),
  hasOthers: z.boolean().optional(),
  hasNone: z.boolean().optional(),
  hasSkip: z.boolean().optional(),
  size: z.string().max(4).optional(),
  topic: z.string().trim().toLowerCase().max(40).nullable().optional(),
  answeredBy: z.enum(['teen', 'parent', 'both']).optional(),
};
export const QuestionCreate = z
  .object({
    name: QuestionKey,
    ...QuestionFields,
    label: z.string().trim().min(1).max(500),
    type: z.string().trim().min(1).max(40),
  })
  .extend({ category: QuestionFields.category.unwrap(), reason: Reason.optional() })
  .strict();
export type QuestionCreate = z.infer<typeof QuestionCreate>;
export const QuestionUpdate = z.object({ ...QuestionFields, reason: Reason.optional() }).strict();
export type QuestionUpdate = z.infer<typeof QuestionUpdate>;

export const OptionInput = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(500),
  isExclusive: z.boolean().optional(),
  parentValue: z.array(z.string().max(200)).max(200).optional(),
  describeLabel: z.string().max(200).optional(),
  countries: z
    .array(z.string().regex(/^[a-zA-Z]{2}$/))
    .max(250)
    .optional(),
});
export const OptionsSet = z.object({ options: z.array(OptionInput).max(2000), reason: Reason.optional() });
export type OptionsSet = z.infer<typeof OptionsSet>;

export const ProfileUpdate = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: z.string().max(200).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
    points: z.number().int().min(0).max(10_000).nullable().optional(),
    estimatedMinutes: z.number().int().min(1).max(120).nullable().optional(),
    pages: z
      .array(z.array(z.string().max(120)).min(1).max(500))
      .max(50)
      .optional(),
    reason: Reason.optional(),
  })
  .strict();
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

/** Today's export shape: Profile, Question and Option arrays (plural names accepted too). */
const Rows = z.array(z.record(z.string(), z.unknown())).max(50_000);
export const BankFile = z
  .object({
    Profile: Rows.optional(),
    Profiles: Rows.optional(),
    Question: Rows.optional(),
    Questions: Rows.optional(),
    Option: Rows.optional(),
    Options: Rows.optional(),
  })
  .passthrough();
export type BankFile = z.infer<typeof BankFile>;
