import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * PostgreSQL holds identity, memberships, consent, reviews, jobs and audit - the relational, transactional
 * side of MADP. Flexible questionnaire definitions and answers live in MongoDB (see src/mongo).
 * Every row that can hold panel data carries data_mode so DEMO fixtures can never mix with live data.
 */
export const dataMode = pgEnum('data_mode', ['demo', 'live']);
export const panelCode = pgEnum('panel_code', ['t2o', 'mfr', 'mho']);
export const audienceCategory = pgEnum('audience_category', [
  'consumer',
  'business_professional',
  'healthcare_professional',
  'patient',
  'caregiver',
]);
export const adminRole = pgEnum('admin_role', [
  'super_admin',
  'platform_admin',
  'data_steward',
  'privacy_officer',
  'analyst',
  'support',
]);
export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected', 'needs_info']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const consentStatus = pgEnum('consent_status', ['granted', 'denied', 'withdrawn', 'unknown']);
export const verificationState = pgEnum('verification_state', ['unverified', 'verified', 'rejected']);
export const sensitivity = pgEnum('sensitivity', ['standard', 'personal', 'special_category']);

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const panels = pgTable('panel', {
  code: panelCode('code').primaryKey(),
  name: text('name').notNull(),
  sensitive: boolean('sensitive').notNull().default(false),
  createdAt: created(),
});

export const masterPersons = pgTable(
  'master_person',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    /** ISO 3166-1 alpha-2, lower case; from the highest-precedence source identity. */
    country: text('country'),
    state: text('state'),
    city: text('city'),
    birthYear: smallint('birth_year'),
    gender: text('gender'),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('master_person_mode_country_idx').on(t.dataMode, t.country)],
);

/** One row per panel account. PII is AES-256-GCM encrypted at field level; lookups use keyed hashes. */
export const sourceIdentities = pgTable(
  'source_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: panelCode('panel').notNull(),
    sourceMemberId: text('source_member_id').notNull(),
    sourceRespondentRef: text('source_respondent_ref'),
    masterPersonId: uuid('master_person_id')
      .notNull()
      .references(() => masterPersons.id),
    sourceCategory: text('source_category').notNull(),
    emailHash: text('email_hash'),
    emailEnc: text('email_enc'),
    emailMasked: text('email_masked'),
    phoneEnc: text('phone_enc'),
    firstNameEnc: text('first_name_enc'),
    lastNameEnc: text('last_name_enc'),
    dateOfBirthEnc: text('date_of_birth_enc'),
    emailVerification: verificationState('email_verification').notNull().default('unverified'),
    phoneVerification: verificationState('phone_verification').notNull().default('unverified'),
    qualityScore: integer('quality_score'),
    sourceActive: boolean('source_active').notNull().default(true),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    lastImportJobId: uuid('last_import_job_id'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('source_identity_source_key').on(t.dataMode, t.panel, t.sourceMemberId),
    index('source_identity_email_hash_idx').on(t.dataMode, t.emailHash),
    index('source_identity_person_idx').on(t.masterPersonId),
  ],
);

/** A person's membership of one panel. Reward balances and communications stay per membership. */
export const panelMemberships = pgTable(
  'panel_membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    masterPersonId: uuid('master_person_id')
      .notNull()
      .references(() => masterPersons.id),
    panel: panelCode('panel').notNull(),
    sourceIdentityId: uuid('source_identity_id')
      .notNull()
      .references(() => sourceIdentities.id),
    status: text('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('panel_membership_identity_key').on(t.sourceIdentityId),
    index('panel_membership_person_idx').on(t.masterPersonId),
  ],
);

export const categoryMemberships = pgTable(
  'category_membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    masterPersonId: uuid('master_person_id')
      .notNull()
      .references(() => masterPersons.id),
    category: audienceCategory('category').notNull(),
    panel: panelCode('panel').notNull(),
    /** How the membership was derived, e.g. "source_category:b2c". */
    basis: text('basis').notNull(),
    isMinor: boolean('is_minor').notNull().default(false),
    createdAt: created(),
  },
  (t) => [uniqueIndex('category_membership_key').on(t.masterPersonId, t.category, t.panel)],
);

/** Candidate links between master persons. Ambiguous matches always wait for a human; links are reversible. */
export const identityMatchCandidates = pgTable('identity_match_candidate', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataMode: dataMode('data_mode').notNull(),
  sourceIdentityId: uuid('source_identity_id')
    .notNull()
    .references(() => sourceIdentities.id),
  candidatePersonId: uuid('candidate_person_id')
    .notNull()
    .references(() => masterPersons.id),
  rule: text('rule').notNull(),
  status: reviewStatus('status').notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: created(),
});

export const consentRecords = pgTable(
  'consent_record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    masterPersonId: uuid('master_person_id')
      .notNull()
      .references(() => masterPersons.id),
    panel: panelCode('panel').notNull(),
    purpose: text('purpose').notNull(),
    channel: text('channel'),
    status: consentStatus('status').notNull(),
    evidence: jsonb('evidence').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index('consent_person_idx').on(t.masterPersonId, t.panel, t.purpose),
    // One current record per person, panel and purpose; each sync updates it in place.
    uniqueIndex('consent_current_uq').on(t.dataMode, t.masterPersonId, t.panel, t.purpose),
  ],
);

export const attributeDefinitions = pgTable('attribute_definition', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  category: audienceCategory('category'),
  valueType: text('value_type').notNull(),
  sensitivity: sensitivity('sensitivity').notNull().default('standard'),
  description: text('description').notNull().default(''),
  createdAt: created(),
});

/** Review queue + approved mappings from a source question version to a canonical attribute. */
export const sourceQuestionMappings = pgTable(
  'source_question_mapping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: panelCode('panel').notNull(),
    sourceQuestionId: text('source_question_id').notNull(),
    questionVersion: integer('question_version').notNull(),
    suggestedAttributeKey: text('suggested_attribute_key').references(() => attributeDefinitions.key),
    suggestionBasis: text('suggestion_basis'),
    attributeKey: text('attribute_key').references(() => attributeDefinitions.key),
    status: reviewStatus('status').notNull().default('pending'),
    valueMap: jsonb('value_map'),
    notes: text('notes'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('mapping_question_version_key').on(
      t.dataMode,
      t.panel,
      t.sourceQuestionId,
      t.questionVersion,
    ),
  ],
);

export const importJobs = pgTable('import_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataMode: dataMode('data_mode').notNull(),
  panel: panelCode('panel').notNull(),
  kind: text('kind').notNull(),
  dryRun: boolean('dry_run').notNull().default(false),
  status: jobStatus('status').notNull().default('queued'),
  requestedBy: uuid('requested_by'),
  counts: jsonb('counts')
    .notNull()
    .default(sql`'{}'::jsonb`),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: created(),
});

/**
 * Dead-letter queue for source reads that still failed after the connector's retries. Holds source member ids
 * (pseudonymous references) and the error only - never answer values or PII. Entries are retried from the
 * Connectors screen and resolved, never deleted.
 */
export const deadLetters = pgTable(
  'dead_letter',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: panelCode('panel').notNull(),
    importJobId: uuid('import_job_id').references(() => importJobs.id),
    stream: text('stream').notNull(),
    sourceMemberIds: jsonb('source_member_ids').$type<string[]>().notNull(),
    errorKind: text('error_kind').notNull(),
    error: text('error').notNull(),
    attempts: integer('attempts').notNull().default(1),
    status: text('status').$type<'open' | 'resolved'>().notNull().default('open'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index('dead_letter_open_idx').on(t.dataMode, t.panel, t.status)],
);

export const syncCheckpoints = pgTable(
  'sync_checkpoint',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: panelCode('panel').notNull(),
    stream: text('stream').notNull(),
    cursor: text('cursor'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastJobId: uuid('last_job_id'),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('sync_checkpoint_key').on(t.dataMode, t.panel, t.stream)],
);

/** Inbound source events (webhooks) - none of the panels emits webhooks yet; the table exists for M3. */
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panel: panelCode('panel').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    eventType: text('event_type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    signatureValid: boolean('signature_valid').notNull(),
    payloadRef: text('payload_ref').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [uniqueIndex('webhook_inbox_idem').on(t.panel, t.idempotencyKey)],
);

/** Transactional outbox: rows written in the same transaction as the change they announce. */
export const outbox = pgTable('outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: created(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const adminUsers = pgTable('admin_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: adminRole('role').notNull(),
  totpSecretEnc: text('totp_secret_enc'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
});

/** Append-only. A trigger in the migration rejects UPDATE and DELETE. Never stores raw PII in metadata. */
export const auditEvents = pgTable(
  'audit_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    outcome: text('outcome').notNull().default('success'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ip: text('ip'),
  },
  (t) => [index('audit_event_at_idx').on(t.at), index('audit_event_actor_idx').on(t.actorId)],
);
