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

// ---- question bank versions and translations ----------------------------------------------------------------------
export const VersionCreate = z.object({ note: z.string().trim().max(500).optional() });
export type VersionCreate = z.infer<typeof VersionCreate>;
export const VersionAction = z.enum(['review', 'publish', 'discard']);
export type VersionAction = z.infer<typeof VersionAction>;
const Lang = z
  .string()
  .trim()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'a language code like hi or pt-BR');
export const TranslationSet = z.object({
  lang: Lang,
  label: z.string().trim().max(500).optional(),
  description: z.string().max(2000).optional(),
  options: z
    .array(z.object({ value: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(500) }))
    .max(2000)
    .optional(),
});
export type TranslationSet = z.infer<typeof TranslationSet>;
export const MissingTranslations = z.object({
  lang: Lang,
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type MissingTranslations = z.infer<typeof MissingTranslations>;

// ---- step 3a: segments, audiences, surveys, points, quality, referrals --------------------------------------------
const Country = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{2}$/, 'a two-letter country code');
export const SegmentTheme = z.enum([
  'consumer',
  'professional',
  'teen',
  'healthcare',
  'patient',
  'caregiver',
]);
export const SegmentUpdate = z
  .object({
    signupOpen: z.boolean().optional(),
    countries: z.array(Country).max(250).optional(),
    minAge: z.number().int().min(13).max(99).optional(),
    coreProfiles: z.array(z.string().trim().toLowerCase().min(1).max(80)).max(50).optional(),
    theme: SegmentTheme.nullable().optional(),
    reason: Reason,
  })
  .strict();
export type SegmentUpdate = z.infer<typeof SegmentUpdate>;

export const AudienceFilter = z
  .object({
    categories: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
    countries: z.array(Country).max(250).optional(),
    ageMin: z.number().int().min(13).max(120).optional(),
    ageMax: z.number().int().min(13).max(120).optional(),
    qualityMin: z.number().min(0).max(200).optional(),
    qualityMax: z.number().min(0).max(200).optional(),
    activeWithinDays: z.number().int().min(1).max(3650).optional(),
    verifiedEmail: z.boolean().optional(),
    answers: z
      .array(
        z.object({
          question: z.string().trim().toLowerCase().min(1).max(80),
          values: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
        }),
      )
      .max(20)
      .optional(),
  })
  .strict();
export type AudienceFilter = z.infer<typeof AudienceFilter>;
export const AudienceCount = z.object({ filter: AudienceFilter.default({}) });
export type AudienceCount = z.infer<typeof AudienceCount>;
export const AudienceSave = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(500).optional(),
  filter: AudienceFilter,
});
export type AudienceSave = z.infer<typeof AudienceSave>;

const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,79}$/, '2 to 80 lower-case letters, digits or dashes');
const SurveyFields = {
  name: z.string().trim().min(1).max(200),
  slug: Slug,
  category: z.string().trim().toLowerCase().min(1).max(40),
  source: z.string().trim().toLowerCase().min(1).max(40),
  points: z.number().int().min(0).max(100_000),
  loi: z.number().int().min(1).max(180),
  summary: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  link: z
    .string()
    .trim()
    .regex(/^https:\/\/\S+$/, 'an https link')
    .or(z.literal(''))
    .optional(),
  activeFrom: z.string().datetime({ offset: true }).or(z.literal('')).nullable().optional(),
  activeTo: z.string().datetime({ offset: true }).or(z.literal('')).nullable().optional(),
  minQualityScore: z.number().min(0).max(200).nullable().optional(),
  premium: z
    .object({
      enabled: z.boolean(),
      industries: z.array(z.string().trim().toLowerCase().max(80)).max(50).default([]),
      seniority: z.array(z.string().trim().toLowerCase().max(80)).max(50).default([]),
    })
    .optional(),
  autoInvite: z.boolean().optional(),
  batchSize: z.number().int().min(1).max(1_000_000).nullable().optional(),
};
export const SurveyCreate = z.object({ ...SurveyFields, reason: Reason.optional() }).strict();
export type SurveyCreate = z.infer<typeof SurveyCreate>;
export const SurveyUpdate = z.object(SurveyFields).partial().extend({ reason: Reason.optional() }).strict();
export type SurveyUpdate = z.infer<typeof SurveyUpdate>;
export const SurveyStatus = z.enum(['draft', 'active', 'paused', 'closed']);
export type SurveyStatus = z.infer<typeof SurveyStatus>;
export const SurveyStatusChange = z.object({ status: SurveyStatus, reason: Reason.optional() });
export type SurveyStatusChange = z.infer<typeof SurveyStatusChange>;
export const SurveyList = z.object({
  status: SurveyStatus.optional(),
  category: z.string().trim().max(40).optional(),
  q: z.string().trim().max(80).optional(),
});
export type SurveyList = z.infer<typeof SurveyList>;
export const InviteTarget = z
  .object({
    audienceId: ObjectId.optional(),
    filter: AudienceFilter.optional(),
    limit: z.number().int().min(1).max(50_000).optional(),
  })
  .strict();
export type InviteTarget = z.infer<typeof InviteTarget>;
export const InviteRun = InviteTarget.extend({
  dryRun: z.boolean().default(true),
  reason: Reason.optional(),
});
export type InviteRun = z.infer<typeof InviteRun>;
export const ResponseStatus = z.enum([
  'invited',
  'dropout',
  'complete',
  'terminate',
  'overquota',
  'rejected',
]);
export const ResponseList = z.object({
  status: ResponseStatus.optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type ResponseList = z.infer<typeof ResponseList>;
export const Reconcile = z.object({
  approve: z.array(ObjectId).max(10_000).default([]),
  reject: z.array(ObjectId).max(10_000).default([]),
  reason: Reason,
});
export type Reconcile = z.infer<typeof Reconcile>;

export const PointsReason = z.enum([
  'goodwill',
  'survey_credit_missing',
  'survey_reversal',
  'fraud_reversal',
  'duplicate_payment',
  'support_fix',
  'migration',
  'other',
]);
export const PointsAdjust = z.object({
  points: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((n) => n !== 0, 'not 0'),
  reasonCode: PointsReason,
  note: Reason,
});
export type PointsAdjust = z.infer<typeof PointsAdjust>;
export const PointsDecision = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
});
export type PointsDecision = z.infer<typeof PointsDecision>;
export const ApprovalList = z.object({
  status: z.enum(['pending', 'applied', 'rejected', 'all']).default('pending'),
});
export type ApprovalList = z.infer<typeof ApprovalList>;
export const HoldCreate = z.object({
  member: ObjectId,
  source: z.enum(['survey', 'reward']),
  entry: ObjectId,
  reason: Reason,
  memberNote: z.string().max(200).optional(),
  expectedBy: day.optional(),
});
export type HoldCreate = z.infer<typeof HoldCreate>;
export const HoldRelease = z.object({ reason: Reason });
export type HoldRelease = z.infer<typeof HoldRelease>;

export const QualityRule = z.enum([
  'speeding',
  'straightlining',
  'open_end_quality',
  'attention_check',
  'client_rejection',
  'duplicate_account',
  'manual_review',
  'restore',
]);
export const QualityChange = z.object({
  rule: QualityRule,
  delta: z
    .number()
    .int()
    .min(-200)
    .max(200)
    .refine((n) => n !== 0, 'not 0'),
  note: Reason,
  survey: z.string().trim().max(80).optional(),
});
export type QualityChange = z.infer<typeof QualityChange>;
export const QualityReview = z.object({
  below: z.coerce.number().min(0).max(200).default(60),
  category: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type QualityReview = z.infer<typeof QualityReview>;
export const ReferralFraud = z.object({ minReferrals: z.coerce.number().int().min(2).max(1000).default(5) });
export type ReferralFraud = z.infer<typeof ReferralFraud>;

// ---- step 3b: ticket desk, portal messages, help centre ------------------------------------------------------------
export const TicketStatus = z.enum(['new', 'open', 'pending', 'resolved', 'closed']);
export const TicketPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export const TicketList = z.object({
  status: z.union([TicketStatus, z.literal('open_all')]).optional(),
  priority: TicketPriority.optional(),
  assignedTo: z.string().trim().max(120).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type TicketList = z.infer<typeof TicketList>;
export const TicketReply = z.object({
  message: z.string().trim().min(2).max(5000),
  internal: z.boolean().default(false),
  status: TicketStatus.optional(),
});
export type TicketReply = z.infer<typeof TicketReply>;
export const TicketStatusChange = z.object({
  status: TicketStatus,
  reason: z.string().trim().max(500).optional(),
});
export type TicketStatusChange = z.infer<typeof TicketStatusChange>;
export const TicketUpdate = z
  .object({
    priority: TicketPriority.optional(),
    assignedTo: z.string().trim().max(120).optional(),
    category: z.string().trim().max(60).optional(),
  })
  .strict();
export type TicketUpdate = z.infer<typeof TicketUpdate>;

const MemberPath = z
  .string()
  .trim()
  .regex(/^\/member(\/[A-Za-z0-9/_?=&.-]*)?$/, 'a member-area path like /member/surveys')
  .or(z.literal(''));
const MessageFields = {
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(4000),
  cta: MemberPath.optional(),
  ctaLabel: z.string().trim().max(60).optional(),
  filter: AudienceFilter.optional(),
};
export const MessageCreate = z.object(MessageFields).strict();
export type MessageCreate = z.infer<typeof MessageCreate>;
export const MessageUpdate = z.object(MessageFields).partial().strict();
export type MessageUpdate = z.infer<typeof MessageUpdate>;
export const MessageSend = z.object({ audienceId: ObjectId.optional(), reason: Reason });
export type MessageSend = z.infer<typeof MessageSend>;
export const MessagePreview = z.object({ audienceId: ObjectId.optional() });
export type MessagePreview = z.infer<typeof MessagePreview>;
export const MessageWithdraw = z.object({ reason: Reason });
export type MessageWithdraw = z.infer<typeof MessageWithdraw>;

export const HelpTopic = z.enum([
  'start',
  'profiles',
  'surveys',
  'rewards',
  'quality',
  'activity',
  'referrals',
  'account',
  'settings',
  'pro',
  'teen',
  'support',
]);
const HelpText = z.string().trim().min(1).max(2000);
export const HelpBlock = z.union([
  HelpText,
  z.object({ ul: z.array(HelpText).min(1).max(30) }).strict(),
  z.object({ ol: z.array(HelpText).min(1).max(30) }).strict(),
  z.object({ note: HelpText }).strict(),
]);
const HelpFields = {
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  topic: HelpTopic,
  title: z.string().trim().min(3).max(200),
  body: z.array(HelpBlock).min(1).max(40),
  keywords: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).optional(),
  types: z
    .array(z.enum(['consumer', 'professional', 'teen']))
    .max(3)
    .optional(),
};
export const HelpCreate = z.object(HelpFields).strict();
export type HelpCreate = z.infer<typeof HelpCreate>;
export const HelpUpdate = z.object(HelpFields).partial().strict();
export type HelpUpdate = z.infer<typeof HelpUpdate>;
export const HelpStatus = z.object({ status: z.enum(['draft', 'published', 'archived']) });
export type HelpStatus = z.infer<typeof HelpStatus>;
