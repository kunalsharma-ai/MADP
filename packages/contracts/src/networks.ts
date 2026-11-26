import { z } from 'zod';

/**
 * Networks on other software (panels with sourceType `inbox`). They send members, answers, question definitions and
 * deletions to MADP in one of two ways: a CSV or Excel file uploaded on the Networks screen, or the signed push API
 * (`POST /api/v1/networks/:panel/push`). Both land in the same encrypted inbox, and the normal sync reads it, so
 * identity matching, consent, minors and audit work exactly as for T2O, MFR and MHO.
 */

const Id = z.string().trim().min(1).max(128);
const Text = (max: number) => z.string().trim().max(max);
const Nullable = (max: number) => Text(max).nullable().optional().transform((v) => (v ? v : null));
const Iso = z.string().datetime({ offset: true }).nullable().optional().transform((v) => v ?? null);

/** One member as a network sends it. Everything but the id and category is optional. */
export const NetworkMember = z
  .object({
    memberId: Id,
    /** The network's own category value (e.g. "b2c", "student"); Audience segments rules turn it into segments. */
    category: Text(80).min(1),
    email: z.string().trim().email().max(254).nullable().optional().transform((v) => v ?? null),
    phone: Nullable(40),
    firstName: Nullable(100),
    lastName: Nullable(100),
    gender: Nullable(40),
    /** YYYY-MM-DD. */
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD')
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    /** ISO 3166-1 alpha-2. */
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'a two-letter country code')
      .nullable()
      .optional()
      .transform((v) => (v ? v.toLowerCase() : null)),
    state: Nullable(100),
    city: Nullable(100),
    emailVerified: z.boolean().optional().default(false),
    phoneVerified: z.boolean().optional().default(false),
    active: z.boolean().optional().default(true),
    /** Marketing e-mail consent as the network recorded it. Left out means unknown. */
    marketingConsent: z.enum(['granted', 'denied', 'withdrawn']).optional(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type NetworkMember = z.infer<typeof NetworkMember>;

export const NetworkAnswer = z
  .object({ memberId: Id, questionId: Id, values: z.array(Text(500)).min(1).max(100), updatedAt: Iso })
  .strict();
export type NetworkAnswer = z.infer<typeof NetworkAnswer>;

export const NetworkQuestion = z
  .object({
    questionId: Id,
    label: Text(1000).min(1),
    type: Nullable(40),
    options: z
      .array(z.object({ value: Text(200).min(1), label: Text(500).min(1) }).strict())
      .max(2000)
      .optional()
      .default([]),
  })
  .strict();
export type NetworkQuestion = z.infer<typeof NetworkQuestion>;

export const NetworkDeletion = z
  .object({ memberId: Id, kind: z.enum(['member', 'answers']).default('member'), at: Iso })
  .strict();
export type NetworkDeletion = z.infer<typeof NetworkDeletion>;

/** Body of the signed push API. Sign `<timestamp>.<batch>.<raw body>` with the panel's push key (HMAC-SHA256). */
export const NetworkPush = z
  .object({
    members: z.array(NetworkMember).max(5000).optional().default([]),
    answers: z.array(NetworkAnswer).max(20000).optional().default([]),
    questions: z.array(NetworkQuestion).max(2000).optional().default([]),
    deletions: z.array(NetworkDeletion).max(5000).optional().default([]),
  })
  .strict();
export type NetworkPush = z.infer<typeof NetworkPush>;

/** A batch id: letters, digits, `-`, `_` or `.`, 8 to 64. Each batch is accepted once per panel. */
export const NETWORK_BATCH_ID = /^[A-Za-z0-9_.-]{8,64}$/;

export const NetworkFileKind = z.enum(['members', 'answers', 'questions']);
export type NetworkFileKind = z.infer<typeof NetworkFileKind>;

export const NetworkUpload = z
  .object({
    kind: NetworkFileKind,
    format: z.enum(['csv', 'xlsx']),
    /** base64 */
    file: z
      .string()
      .max(25 * 1024 * 1024)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'base64'),
    /** true: check the file and show what would be imported, without saving anything. */
    dryRun: z.boolean().default(true),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type NetworkUpload = z.infer<typeof NetworkUpload>;

export interface NetworkUploadResult {
  dryRun: boolean;
  kind: NetworkFileKind;
  rows: number;
  accepted: number;
  /** At most 50, by row number (the header is row 1). Values are never echoed back. */
  problems: { row: number; message: string }[];
  /** Column names found and the field each one fills. */
  columns: { column: string; field: string | null }[];
  batch: string | null;
}

/** File columns for each kind. Header names are matched case-insensitively, ignoring spaces, `-` and `_`. */
export const NETWORK_FILE_COLUMNS: Record<NetworkFileKind, { field: string; aliases: string[]; required?: boolean; help: string }[]> = {
  members: [
    { field: 'memberId', aliases: ['member_id', 'id', 'user_id', 'respondent_id'], required: true, help: "The network's own member id" },
    { field: 'category', aliases: ['category', 'segment', 'type'], required: true, help: 'The network category, e.g. b2c' },
    { field: 'email', aliases: ['email', 'e-mail', 'email_address'], help: 'E-mail address' },
    { field: 'phone', aliases: ['phone', 'mobile', 'phone_number'], help: 'Phone number' },
    { field: 'firstName', aliases: ['first_name', 'firstname', 'given_name'], help: 'First name' },
    { field: 'lastName', aliases: ['last_name', 'lastname', 'surname', 'family_name'], help: 'Last name' },
    { field: 'gender', aliases: ['gender', 'sex'], help: 'Gender as recorded' },
    { field: 'dateOfBirth', aliases: ['date_of_birth', 'dob', 'birth_date', 'birthdate'], help: 'YYYY-MM-DD' },
    { field: 'country', aliases: ['country', 'country_code'], help: 'Two-letter code, e.g. IN' },
    { field: 'state', aliases: ['state', 'region', 'province'], help: 'State or region' },
    { field: 'city', aliases: ['city', 'town'], help: 'City' },
    { field: 'emailVerified', aliases: ['email_verified'], help: 'yes / no' },
    { field: 'phoneVerified', aliases: ['phone_verified'], help: 'yes / no' },
    { field: 'active', aliases: ['active', 'is_active', 'status'], help: 'yes / no (or active / inactive)' },
    { field: 'marketingConsent', aliases: ['marketing_consent', 'email_marketing', 'newsletter'], help: 'granted / denied / withdrawn' },
    { field: 'createdAt', aliases: ['created_at', 'joined', 'joined_at', 'signup_date'], help: 'Date or date-time' },
    { field: 'updatedAt', aliases: ['updated_at', 'last_updated'], help: 'Date or date-time' },
  ],
  answers: [
    { field: 'memberId', aliases: ['member_id', 'id', 'user_id', 'respondent_id'], required: true, help: "The network's member id" },
    { field: 'questionId', aliases: ['question_id', 'question', 'question_key'], required: true, help: 'The question id' },
    { field: 'values', aliases: ['value', 'values', 'answer', 'answers'], required: true, help: 'One value, or several separated by |' },
    { field: 'updatedAt', aliases: ['updated_at', 'answered_at'], help: 'Date or date-time' },
  ],
  questions: [
    { field: 'questionId', aliases: ['question_id', 'id', 'key', 'question_key'], required: true, help: 'The question id' },
    { field: 'label', aliases: ['label', 'question', 'text', 'question_text'], required: true, help: 'The question as members see it' },
    { field: 'type', aliases: ['type', 'question_type'], help: 'e.g. single, multi, text' },
    { field: 'options', aliases: ['options', 'answers', 'choices'], help: 'value=label pairs separated by |' },
  ],
};

export interface NetworkStatus {
  panel: string;
  name: string;
  liveApproved: boolean;
  pushKey: { set: boolean; hint: string | null; createdAt: string | null };
  inbox: { members: number; answers: number; questions: number; deletions: number };
  batches: {
    batch: string;
    source: 'upload' | 'push';
    kind: string;
    records: number;
    receivedAt: string;
  }[];
}
