import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
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
    /** `active`, or `merged` once every source identity has moved to another person (kept for unmerge). */
    status: text('status').notNull().default('active'),
    /** Which source identity supplied each field above, by the source precedence rule (identity/precedence.ts). */
    fieldSources: jsonb('field_sources'),
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
    /** Location and demographics as this panel reported them; the person's values are chosen from these. */
    country: text('country'),
    state: text('state'),
    city: text('city'),
    gender: text('gender'),
    birthYear: smallint('birth_year'),
    /** IANA time zone the member gave the panel; used for quiet hours. */
    timezone: text('timezone'),
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

/** Every merge and unmerge of a source identity, so each link can be explained and reversed. Append only. */
export const identityLinkEvents = pgTable(
  'identity_link_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    action: text('action').notNull(),
    sourceIdentityId: uuid('source_identity_id')
      .notNull()
      .references(() => sourceIdentities.id),
    fromPersonId: uuid('from_person_id')
      .notNull()
      .references(() => masterPersons.id),
    toPersonId: uuid('to_person_id')
      .notNull()
      .references(() => masterPersons.id),
    candidateId: uuid('candidate_id').references(() => identityMatchCandidates.id),
    reason: text('reason'),
    actorId: uuid('actor_id'),
    createdAt: created(),
  },
  (t) => [
    index('identity_link_event_identity_idx').on(t.sourceIdentityId, t.createdAt),
    index('identity_link_event_from_idx').on(t.fromPersonId),
    index('identity_link_event_to_idx').on(t.toPersonId),
  ],
);

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

// ---------------------------------------------------------------------------------------------------------------
// Engagement (Milestone 4, part 1). Templates and campaigns belong to one panel: each brand keeps its own sender,
// footer, consents and history. Nothing is sent from here yet: runs are dry runs that record what would happen.

/** A reusable message for one panel. Its content lives in versions; an approved version never changes. */
export const messageTemplates = pgTable(
  'message_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panel: panelCode('panel').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** welcome, newsletter, birthday, festival, reengagement, profile_recovery, survey_reminder, service. */
    kind: text('kind').notNull(),
    channel: text('channel').notNull().default('email'),
    createdBy: uuid('created_by'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('message_template_key').on(t.panel, t.key)],
);

export const messageTemplateVersions = pgTable(
  'message_template_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => messageTemplates.id),
    version: integer('version').notNull(),
    language: text('language').notNull().default('en'),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text').notNull(),
    /** draft -> in_review -> approved | rejected; approved -> retired. */
    status: text('status').notNull().default('draft'),
    createdBy: uuid('created_by'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('message_template_version_key').on(t.templateId, t.version)],
);

/** Per-panel contact rules. Frequency caps and quiet hours apply to every non-service message of that panel. */
export const fatiguePolicies = pgTable('fatigue_policy', {
  panel: panelCode('panel').primaryKey(),
  maxPerWeek: integer('max_per_week').notNull().default(2),
  maxPerMonth: integer('max_per_month').notNull().default(6),
  /** Local hours (0-23) in the member's time zone when nothing is scheduled. */
  quietStartHour: smallint('quiet_start_hour').notNull().default(21),
  quietEndHour: smallint('quiet_end_hour').notNull().default(8),
  /** Fatigue score bands: score >= value -> band. */
  bands: jsonb('bands').notNull().default(sql`'{"high": 60, "medium": 30}'::jsonb`),
  updatedBy: uuid('updated_by'),
  updatedAt: updated(),
});

export const campaigns = pgTable(
  'campaign',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: panelCode('panel').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => messageTemplateVersions.id),
    /** Audience: categories and countries within this panel. */
    audience: jsonb('audience').notNull(),
    /** draft -> approved -> paused | archived. Only an approved campaign can run. */
    status: text('status').notNull().default('draft'),
    createdBy: uuid('created_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('campaign_panel_idx').on(t.dataMode, t.panel, t.status)],
);

export const campaignRuns = pgTable('campaign_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  dryRun: boolean('dry_run').notNull(),
  counts: jsonb('counts'),
  requestedBy: uuid('requested_by'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/**
 * One line of a person's communication timeline: planned, suppressed (with the reason), and later the provider's
 * delivery states. Dry-run lines are flagged and never count towards frequency caps.
 */
export const communicationEvents = pgTable(
  'communication_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    masterPersonId: uuid('master_person_id')
      .notNull()
      .references(() => masterPersons.id),
    panel: panelCode('panel').notNull(),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    runId: uuid('run_id').references(() => campaignRuns.id),
    automationId: uuid('automation_id').references(() => automations.id),
    automationRunId: uuid('automation_run_id').references(() => automationRuns.id),
    /** The automation step (its day) this line belongs to. */
    step: integer('step'),
    channel: text('channel').notNull(),
    /** planned, suppressed, queued, sent, delivered, bounced, complained, failed, opened, clicked, opted_out. */
    state: text('state').notNull(),
    reason: text('reason'),
    dryRun: boolean('dry_run').notNull(),
    plannedFor: timestamp('planned_for', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('communication_event_person_idx').on(t.masterPersonId, t.occurredAt),
    index('communication_event_run_idx').on(t.runId),
    index('communication_event_automation_idx').on(t.automationId, t.masterPersonId),
    index('communication_event_panel_state_idx').on(t.panel, t.state, t.occurredAt),
  ],
);

// Lifecycle automations and the celebration calendar (Milestone 4, part 2).

/**
 * A dated greeting for one panel, reviewed by a second person before any automation can use it. `civic` entries go
 * to members in the listed countries; `religious_cultural` entries only to members who chose that greeting.
 */
export const celebrationDates = pgTable(
  'celebration_date',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panel: panelCode('panel').notNull(),
    name: text('name').notNull(),
    observance: text('observance').notNull(),
    onDate: date('on_date').notNull(),
    countries: text('countries').array().notNull(),
    note: text('note'),
    /** pending -> approved | rejected. */
    status: text('status').notNull().default('pending'),
    createdBy: uuid('created_by'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: created(),
  },
  (t) => [index('celebration_date_panel_idx').on(t.panel, t.onDate)],
);

/** A lifecycle automation. Its rules live in versions; `currentVersionId` is the approved one that runs. */
export const automations = pgTable(
  'automation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: panelCode('panel').notNull(),
    name: text('name').notNull(),
    trigger: text('trigger').notNull(),
    /** draft (nothing approved yet) -> active <-> paused; any -> archived. */
    status: text('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    createdBy: uuid('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('automation_panel_idx').on(t.dataMode, t.panel, t.status)],
);

/** One version of an automation's rules. Approved versions never change; a change or a rollback is a new version. */
export const automationVersions = pgTable(
  'automation_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id),
    version: integer('version').notNull(),
    config: jsonb('config').notNull(),
    steps: jsonb('steps').notNull(),
    /** draft -> in_review -> approved | rejected; approved -> superseded. */
    status: text('status').notNull().default('draft'),
    /** The version this one was restored from, for a rollback. */
    restoredFrom: uuid('restored_from'),
    createdBy: uuid('created_by'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('automation_version_key').on(t.automationId, t.version)],
);

export const automationRuns = pgTable('automation_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  automationId: uuid('automation_id')
    .notNull()
    .references(() => automations.id),
  versionId: uuid('version_id')
    .notNull()
    .references(() => automationVersions.id),
  dryRun: boolean('dry_run').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  counts: jsonb('counts'),
  error: text('error'),
  requestedBy: uuid('requested_by'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
