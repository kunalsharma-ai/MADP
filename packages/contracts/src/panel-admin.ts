import { z } from 'zod';

/**
 * Super admin console, modules 1 to 4 (members, question bank, profiles). MADP checks the admin's permission and
 * brand, writes the audit entry, then calls the panel backend's signed /api/v1/admin for that brand.
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
  /** Marketing e-mail opt-in ("Send me news and offers"). `unset` means never asked, which counts as no. */
  marketing: z.enum(['granted', 'withdrawn', 'unset']).optional(),
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

/** Reset link, welcome again or "log in as member": the admin's reason, nothing else. */
export const MemberActionReason = z.object({ reason: Reason }).strict();
export type MemberActionReason = z.infer<typeof MemberActionReason>;

/**
 * Answer of the panel's reset-password and resend-welcome routes. Nothing is sent while the brand's
 * email_admin_actions switch is off; `wouldSend` says what would go out, with the address masked.
 */
export const MemberEmailResult = z.object({
  sent: z.boolean(),
  switch: z.string(),
  wouldSend: z.object({ template: z.string(), to: z.string(), brand: z.string(), subject: z.string() }),
});
export type MemberEmailResult = z.infer<typeof MemberEmailResult>;

/** A one-use "log in as member" link: open it within `redeemBy`; the session ends at `expiresAt` (15 minutes). */
export const MemberLoginAs = z.object({
  sessionId: z.string(),
  url: z.string().url(),
  redeemBy: z.string(),
  expiresAt: z.string(),
  refused: z.array(z.string()),
});
export type MemberLoginAs = z.infer<typeof MemberLoginAs>;

export const AdminSessionState = z.enum(['waiting', 'open', 'unused', 'expired', 'ended']);
export const MemberAdminSessions = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      actor: z.string(),
      reason: z.string(),
      issuedAt: z.string(),
      usedAt: z.string().nullable(),
      expiresAt: z.string(),
      endedAt: z.string().nullable(),
      state: AdminSessionState,
    }),
  ),
});
export type MemberAdminSessions = z.infer<typeof MemberAdminSessions>;

export const ArchiveRun = z.object({
  months: z.number().int().min(1).max(60).optional(),
  dryRun: z.boolean().default(true),
  reason: Reason.optional(),
});
export type ArchiveRun = z.infer<typeof ArchiveRun>;

export const MemberRestore = z.object({ ids: z.array(ObjectId).min(1).max(1000), reason: Reason });
export type MemberRestore = z.infer<typeof MemberRestore>;

// ---- duplicate accounts (MFR#68, Project/api/app/admin/merge.js) -------------------------------------------------
export const DuplicateRule = z.enum(['email', 'phone', 'name_dob']);
export const DuplicateSearch = z.object({
  by: DuplicateRule.default('email'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DuplicateSearch = z.infer<typeof DuplicateSearch>;

/** A merge is a dry run unless `apply` is true; applying needs a reason. */
export const MemberMergeRequest = z
  .object({ keep: ObjectId, duplicate: ObjectId, apply: z.boolean().default(false), reason: Reason.optional() })
  .strict()
  .refine((m) => m.keep !== m.duplicate, { message: 'Choose two different accounts', path: ['duplicate'] })
  .refine((m) => !m.apply || Boolean(m.reason), { message: 'A merge needs a reason', path: ['reason'] });
export type MemberMergeRequest = z.infer<typeof MemberMergeRequest>;

export const MergeHistoryQuery = z.object({ member: ObjectId.optional() });
export type MergeHistoryQuery = z.infer<typeof MergeHistoryQuery>;
export const MergeUndo = z.object({ reason: Reason }).strict();
export type MergeUndo = z.infer<typeof MergeUndo>;

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
/** A translation's language: any code but English, which is the question's own wording (the panel refuses `en`). */
const TranslationLang = Lang.refine((l) => l !== 'en', 'English is the question itself; pick another language');
export const TranslationSet = z.object({
  lang: TranslationLang,
  label: z.string().trim().max(500).optional(),
  description: z.string().max(2000).optional(),
  options: z
    .array(z.object({ value: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(500) }))
    .max(2000)
    .optional(),
});
export type TranslationSet = z.infer<typeof TranslationSet>;
export const MissingTranslations = z.object({
  lang: TranslationLang,
  category: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,60}$/, 'a segment category').optional(),
});
export type MissingTranslations = z.infer<typeof MissingTranslations>;
/**
 * The panel's teen guardrail words (MFR `app/admin/qb.js`, TEEN_BLOCKED). The panel refuses them on questions teens can
 * see, in the question and in its translations (422 `teen_guardrail`). The console uses the same list to warn early.
 */
export const TEEN_BLOCKED_WORDS =
  /tobacco|nicotine|cigar|vap(e|ing)\b|smok|e-?cig|alcohol|beer|wine|liquor|spirits|whisk|vodka|health|medic|illness|disease|diagnos|prescri|pharma|cosmetic|make-?up|skin ?care|vehicle|\bcars?\b|motorcycle|automobile|auto insurance/i;

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

// Expert verification queue (Professionals ask to be shown as verified experts; the team checks by hand).
export const ExpertStatus = z.enum(['requested', 'verified', 'declined']);
export const ExpertList = z.object({
  status: z.enum(['requested', 'verified', 'declined', 'all']).default('requested'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ExpertList = z.infer<typeof ExpertList>;
/** reason goes to the audit log (and the panel's admin note); note is shown to the member and is needed to decline. */
export const ExpertDecision = z
  .object({
    decision: z.enum(['verified', 'declined']),
    reason: Reason,
    note: z.string().trim().min(5).max(300).optional(),
  })
  .strict()
  .refine((b) => b.decision === 'verified' || Boolean(b.note), {
    message: 'Tell the member why it was declined',
    path: ['note'],
  });
export type ExpertDecision = z.infer<typeof ExpertDecision>;

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

// ---- step 4: feature switches, rewards, engagement, teens, data requests -------------------------------------------
/** Panel feature switches. `kill` turns every other switch of the brand off at once. */
export const SwitchKey = z.enum([
  'kill',
  'redemptions',
  'teen_redemptions',
  'draw',
  'email_welcome',
  'email_new_user',
  'email_new_survey',
  'email_birthday',
  'email_lifecycle',
  'email_weekly',
  'email_expiry',
  'email_turning18',
  'push',
  // step 4c (MFR#56)
  'points_hold',
  'points_expiry',
  'weekend_multiplier',
  'bonuses',
  'prize_machines',
  'whatsapp',
]);
export type SwitchKey = z.infer<typeof SwitchKey>;
/** Segments a switch or prize machine can be narrowed to (the panel's member types). */
export const SwitchSegment = z.enum(['consumer', 'professional', 'teen']);
export type SwitchSegment = z.infer<typeof SwitchSegment>;
/** A country as the panel stores it: lower-case name or code, e.g. "india" or "us". */
export const SwitchCountry = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z .'-]{1,59}$/, 'a country name or code');
/** Which members a switch row covers. Neither = the whole brand. */
export const SwitchScope = z
  .object({ segment: SwitchSegment.optional(), country: SwitchCountry.optional() })
  .strict();
export type SwitchScope = z.infer<typeof SwitchScope>;
/**
 * Set a switch for the whole brand or narrowed to a segment and/or country. `on: null` removes a narrower row so the
 * wider one applies again. `value` is the switch's number (hold days, weekend multiplier); the panel checks its range.
 */
export const SwitchSet = z
  .object({
    on: z.boolean().nullable(),
    reason: Reason,
    segment: SwitchSegment.optional(),
    country: SwitchCountry.optional(),
    value: z.number().min(0).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.on !== null || v.segment || v.country, {
    message: 'Only a segment or country setting can be removed',
    path: ['on'],
  });
export type SwitchSet = z.infer<typeof SwitchSet>;
export const SwitchOverride = z.object({
  segment: SwitchSegment.nullable(),
  country: z.string().nullable(),
  on: z.boolean(),
  value: z.number().nullable(),
  reason: z.string().nullable(),
  changedBy: z.string().nullable(),
  changedAt: z.string().nullable(),
  since: z.string().nullable(),
});
export type SwitchOverride = z.infer<typeof SwitchOverride>;
export const SwitchView = z.object({
  key: z.string(),
  group: z.enum(['kill', 'money', 'legal', 'email']),
  label: z.string(),
  /** What members notice when it is on. */
  effect: z.string().optional(),
  default: z.boolean(),
  effective: z.boolean(),
  /** Which row decided `effective` for the scope asked about. */
  from: z.enum(['kill', 'segment+country', 'segment', 'country', 'brand', 'default', 'unknown']).optional(),
  set: z.boolean().nullable(),
  reason: z.string().nullable(),
  changedBy: z.string().nullable(),
  changedAt: z.string().nullable(),
  valued: z
    .object({
      unit: z.string(),
      min: z.number(),
      max: z.number(),
      step: z.number(),
      default: z.number().nullable(),
    })
    .nullable()
    .optional(),
  setValue: z.number().nullable().optional(),
  value: z.number().nullable().optional(),
  overrides: z.array(SwitchOverride).optional(),
});
export type SwitchView = z.infer<typeof SwitchView>;
export const SwitchBoard = z.object({
  killed: z.boolean(),
  scope: z.object({ segment: z.string().nullable(), country: z.string().nullable() }).optional(),
  segments: z.array(z.string()).optional(),
  kill: SwitchView,
  switches: z.array(SwitchView),
});
export type SwitchBoard = z.infer<typeof SwitchBoard>;

// ---- prize machines (MFR#56): one per segment, behind the prize_machines legal switch ---------------------------
export const PRIZE_SKINS = { consumer: 'claw', professional: 'lift', teen: 'spiral' } as const;
export const PrizeKind = z.enum(['points', 'badge', 'nothing']);
export type PrizeKind = z.infer<typeof PrizeKind>;
export const PrizeInput = z
  .object({
    key: z.string().trim().max(40).optional(),
    label: z.string().trim().min(2).max(80),
    kind: PrizeKind,
    points: z.number().int().min(0).max(10_000).optional(),
    weight: z.number().min(0).max(100_000),
  })
  .strict();
export type PrizeInput = z.infer<typeof PrizeInput>;
export const PrizeMachineSave = z
  .object({
    title: z.string().trim().min(2).max(80),
    status: z.enum(['draft', 'live', 'paused']),
    dailyPlays: z.number().int().min(1).max(10),
    countries: z.array(SwitchCountry).max(60),
    prizes: z.array(PrizeInput).min(1).max(12),
    reason: Reason,
  })
  .strict()
  .refine((m) => m.prizes.every((p) => p.kind !== 'points' || (p.points ?? 0) >= 1), {
    message: 'A points prize needs points',
    path: ['prizes'],
  })
  .refine((m) => m.status !== 'live' || m.countries.length > 0, {
    message: 'A live machine needs at least one country',
    path: ['countries'],
  });
export type PrizeMachineSave = z.infer<typeof PrizeMachineSave>;
export const PrizeMachineView = z.object({
  segment: SwitchSegment,
  skin: z.string(),
  exists: z.boolean(),
  id: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(['draft', 'live', 'paused']),
  dailyPlays: z.number(),
  countries: z.array(z.string()),
  prizes: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: PrizeKind,
      points: z.number(),
      weight: z.number(),
      chance: z.number(),
    }),
  ),
  pointsPerPlay: z.number(),
  reason: z.string().nullable(),
  changedBy: z.string().nullable(),
  changedAt: z.string().nullable(),
  plays: z.object({ last30Days: z.number(), pointsLast30Days: z.number() }),
});
export type PrizeMachineView = z.infer<typeof PrizeMachineView>;
export const PrizeMachineList = z.object({ switchOn: z.boolean(), machines: z.array(PrizeMachineView) });
export type PrizeMachineList = z.infer<typeof PrizeMachineList>;

export const RewardKind = z.enum(['giftcard', 'upi', 'paypal', 'charity', 'learning']);
export const MemberType = z.enum(['consumer', 'professional', 'teen']);
const CatalogueFields = {
  kind: RewardKind,
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  image: z.string().trim().url().max(500).optional(),
  points: z.number().int().min(1).max(10_000_000),
  value: z.number().min(0).max(100_000).optional(),
  audience: z.array(MemberType).max(3).optional(),
  countries: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(250).optional(),
  availableUntil: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};
export const CatalogueCreate = z
  .object({
    key: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,60}$/, 'letters, digits and dashes'),
    ...CatalogueFields,
  })
  .strict();
export type CatalogueCreate = z.infer<typeof CatalogueCreate>;
export const CatalogueUpdate = z
  .object({ ...CatalogueFields, active: z.boolean().optional(), reason: Reason })
  .partial({ kind: true, title: true, points: true })
  .strict();
export type CatalogueUpdate = z.infer<typeof CatalogueUpdate>;

export const RedemptionStatus = z.enum([
  'requested',
  'guardian_pending',
  'approved',
  'fulfilled',
  'rejected',
  'cancelled',
]);
export const RedemptionList = z.object({
  status: z.union([RedemptionStatus, z.literal('open')]).optional(),
  kind: RewardKind.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type RedemptionList = z.infer<typeof RedemptionList>;
export const RedemptionDecision = z
  .object({
    status: z.enum(['approved', 'fulfilled', 'rejected']),
    reason: Reason,
    /** Shown to the member. */
    note: z.string().trim().max(300).optional(),
    providerRef: z.string().trim().max(200).optional(),
  })
  .strict();
export type RedemptionDecision = z.infer<typeof RedemptionDecision>;

export const DrawCreate = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM'),
    title: z.string().trim().min(1).max(120),
    prize: z.string().trim().min(1).max(300),
    ticketPoints: z.number().int().min(1).max(1_000_000),
    maxTicketsPerMember: z.number().int().min(1).max(100).optional(),
    winners: z.number().int().min(1).max(100).optional(),
    closesAt: z.string().datetime(),
    rulesUrl: z.string().trim().url().startsWith('https://').max(500),
    countries: z.array(z.string().trim().toLowerCase().min(2).max(40)).min(1).max(250),
  })
  .strict();
export type DrawCreate = z.infer<typeof DrawCreate>;
export const DrawAction = z.object({ reason: Reason }).strict();
export type DrawAction = z.infer<typeof DrawAction>;
export const OfferCreate = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).optional(),
    multiplier: z.number().gt(1).max(5),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    audience: z.array(MemberType).max(3).optional(),
    reason: Reason,
  })
  .strict()
  .refine((o) => new Date(o.endsAt) > new Date(o.startsAt), 'endsAt is after startsAt');
export type OfferCreate = z.infer<typeof OfferCreate>;

export const TaskKind = z.enum(['poll', 'design_vote', 'idea', 'challenge']);
const TaskFields = {
  kind: TaskKind,
  title: z.string().trim().min(1).max(120),
  question: z.string().trim().max(300).optional(),
  description: z.string().trim().max(1000).optional(),
  options: z
    .array(
      z.object({
        key: z.string().trim().max(30).optional(),
        label: z.string().trim().min(1).max(120),
        image: z.string().trim().url().max(500).optional(),
      }),
    )
    .max(8)
    .optional(),
  audience: z.array(MemberType).max(3).optional(),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  season: z.string().trim().max(40).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  points: z.number().int().min(0).max(1000).optional(),
  goal: z
    .object({
      metric: z.enum(['surveys', 'profiles', 'polls', 'active_days', 'tasks']),
      target: z.number().int().min(1).max(1000),
    })
    .optional(),
};
export const TaskCreate = z.object(TaskFields).strict();
export type TaskCreate = z.infer<typeof TaskCreate>;
export const TaskUpdate = z
  .object({ ...TaskFields, active: z.boolean().optional() })
  .omit({ kind: true })
  .partial()
  .strict();
export type TaskUpdate = z.infer<typeof TaskUpdate>;
export const IdeaDecision = z.object({ status: z.enum(['approved', 'rejected']) }).strict();
export type IdeaDecision = z.infer<typeof IdeaDecision>;
const StoryFields = {
  type: z.enum(['story', 'insight']),
  title: z.string().trim().min(1).max(140),
  summary: z.string().trim().max(400).optional(),
  body: z.string().trim().max(8000).optional(),
  image: z.string().trim().url().max(500).optional(),
  /** Only with the client's written permission. */
  brand: z.string().trim().max(80).optional(),
  stats: z
    .array(z.object({ label: z.string().trim().max(80), value: z.string().trim().max(40) }))
    .max(6)
    .optional(),
  audience: z.array(MemberType).max(3).optional(),
  industries: z.array(z.string().trim().max(60)).max(40).optional(),
  sampleSize: z.number().int().min(0).optional(),
  fileUrl: z.string().trim().url().max(500).optional(),
};
export const StoryCreate = z.object(StoryFields).strict();
export type StoryCreate = z.infer<typeof StoryCreate>;
export const StoryUpdate = z
  .object({ ...StoryFields, active: z.boolean().optional(), published: z.boolean().optional() })
  .omit({ type: true })
  .partial()
  .strict();
export type StoryUpdate = z.infer<typeof StoryUpdate>;

export const TeenList = z.object({
  turning18: z.coerce.number().int().min(0).max(365).optional(),
  /** "Waiting to accept adult terms": turned 18, the move has started. */
  stage: z.enum(['turning_adult']).optional(),
});
export type TeenList = z.infer<typeof TeenList>;
export const TeenReason = z.object({ reason: Reason }).strict();
export type TeenReason = z.infer<typeof TeenReason>;
export const AdultSegment = z.enum(['b2c', 'b2b']);
export type AdultSegment = z.infer<typeof AdultSegment>;
export const TeenGraduate = z
  .object({
    reason: Reason.optional(),
    dryRun: z.boolean().default(true),
    segment: AdultSegment.default('b2c'),
  })
  .strict();
export type TeenGraduate = z.infer<typeof TeenGraduate>;

/** The eleven server-enforced statuses of a Teen Panel registration (MFR teen/rules.js). */
export const TEEN_REGISTRATION_STATUSES = [
  'initial_registration',
  'pending_guardian_approval',
  'guardian_approved',
  'pending_onboarding',
  'pending_consent',
  'manual_review',
  'pending_password',
  'active',
  'rejected',
  'expired',
  'cancelled',
] as const;
export const TeenRegistrationStatus = z.enum(TEEN_REGISTRATION_STATUSES);
export type TeenRegistrationStatus = z.infer<typeof TeenRegistrationStatus>;
export const TeenPipelineQuery = z.object({ status: TeenRegistrationStatus.optional() });
export type TeenPipelineQuery = z.infer<typeof TeenPipelineQuery>;
export const TeenRegistrationAction = z.enum(['approve', 'cancel', 'renew']);
export type TeenRegistrationAction = z.infer<typeof TeenRegistrationAction>;

export const DataRequestList = z.object({
  status: z.enum(['open', 'all', 'requested', 'approved', 'rejected', 'done', 'cancelled']).optional(),
});
export type DataRequestList = z.infer<typeof DataRequestList>;
export const DataRequestDecision = z
  .object({
    status: z.enum(['approved', 'rejected', 'done']),
    reason: Reason,
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type DataRequestDecision = z.infer<typeof DataRequestDecision>;

// ---- content and legal pages (kunalsharma-ai/MFR#64, turn2opinion#33, MHO#15: app/admin/content.js) ---------------
/** Keys that are always legal pages on the panel, whatever kind is sent: four eyes to publish. */
export const LEGAL_CONTENT_KEYS = ['privacy', 'terms', 'gdpr', 'cookies'] as const;
export const ContentKind = z.enum(['legal', 'page']);
export type ContentKind = z.infer<typeof ContentKind>;
export const ContentState = z.enum(['editing', 'review', 'published', 'unpublished']);
const ContentText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max);
const ContentList = z.array(ContentText(5000)).min(1).max(100);
/**
 * One block of a page body, exactly as the panel accepts it: text, { h2 }, { h3 }, { ul }, { ol }, { note } or
 * { table: { head, rows } }. No HTML: the sites render plain elements and turn https and e-mail addresses into links.
 */
export const ContentBlock = z.union([
  ContentText(5000),
  z.object({ h2: ContentText(200) }).strict(),
  z.object({ h3: ContentText(200) }).strict(),
  z.object({ note: ContentText(5000) }).strict(),
  z.object({ ul: ContentList }).strict(),
  z.object({ ol: ContentList }).strict(),
  z
    .object({
      table: z
        .object({
          head: z.array(ContentText(5000)).min(1).max(12),
          rows: z.array(z.array(z.string().trim().max(1000))).min(1).max(300),
        })
        .strict()
        .refine((t) => t.rows.every((r) => r.length === t.head.length), 'every row has one cell per column'),
    })
    .strict(),
]);
export type ContentBlock = z.infer<typeof ContentBlock>;
export const ContentBody = z.array(ContentBlock).min(1).max(400);
export const ContentKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,59}$/, '2 to 60 lower-case letters, digits or dashes');
export const ContentLang = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'a language code, e.g. en or es-MX');
export const ContentListQuery = z.object({
  kind: ContentKind.optional(),
  lang: ContentLang.optional(),
  key: ContentKey.optional(),
  state: ContentState.optional(),
});
export type ContentListQuery = z.infer<typeof ContentListQuery>;
export const ContentCreate = z
  .object({ key: ContentKey, kind: ContentKind.optional(), lang: ContentLang.optional(), title: ContentText(200), body: ContentBody })
  .strict();
export type ContentCreate = z.infer<typeof ContentCreate>;
export const ContentUpdate = z
  .object({ title: ContentText(200).optional(), body: ContentBody.optional() })
  .strict()
  .refine((b) => b.title !== undefined || b.body !== undefined, 'Send title, body or both');
export type ContentUpdate = z.infer<typeof ContentUpdate>;
export const ContentAction = z.enum(['review', 'publish', 'discard']);
export type ContentAction = z.infer<typeof ContentAction>;

/** Member alert settings the console may change, the same fields the member can change (MFR#101). */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time like 22:00');
export const MemberAlertsChange = z.object({
  notifications: z
    .object({
      email: z.boolean(),
      push: z.boolean(),
      whatsapp: z.boolean(),
      weeklySummary: z.boolean(),
      expiryReminders: z.boolean(),
      newSurvey: z.boolean(),
      lifecycle: z.boolean(),
      birthday: z.boolean(),
      quietHours: z.object({ enabled: z.boolean(), start: HHMM, end: HHMM }).partial(),
    })
    .partial()
    .optional(),
  survey: z.object({ invitesPerWeek: z.number().int().min(0).max(50).nullable() }).partial().optional(),
  reason: Reason,
});
export type MemberAlertsChange = z.infer<typeof MemberAlertsChange>;

export const MemberResponsesQuery = z.object({
  status: z.string().trim().regex(/^[a-z_]{1,40}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type MemberResponsesQuery = z.infer<typeof MemberResponsesQuery>;
