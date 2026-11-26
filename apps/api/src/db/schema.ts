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
  primaryKey,
  real,
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
export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected', 'needs_info']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const consentStatus = pgEnum('consent_status', ['granted', 'denied', 'withdrawn', 'unknown']);
export const verificationState = pgEnum('verification_state', ['unverified', 'verified', 'rejected']);
export const sensitivity = pgEnum('sensitivity', ['standard', 'personal', 'special_category']);

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * The panels MADP serves. T2O, MFR and MHO are built in (mandatory: they can't be archived or deleted); a Super
 * Admin adds others on the Panels screen. `sensitive` panels hold special-category (health) data and get the
 * enhanced controls: purpose-limited access, cell size 10, minors locked until guardian consent. It can't be turned
 * off on a panel that already holds data, and MHO's is fixed on.
 */
export const panels = pgTable('panel', {
  /** Short lower-case key used everywhere (a, then letters, digits or _; 2 to 16 characters). */
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  siteUrl: text('site_url'),
  description: text('description').notNull().default(''),
  sensitive: boolean('sensitive').notNull().default(false),
  builtIn: boolean('built_in').notNull().default(false),
  /** 'active' or 'archived'. An archived panel isn't synced and its console screens are hidden. */
  status: text('status').notNull().default('active'),
  sort: smallint('sort').notNull().default(100),
  /** 'panel_api' (the shared panel backend) or 'inbox' (a network on other software: file upload or push API). */
  sourceType: text('source_type').notNull().default('panel_api'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by'),
  createdBy: uuid('created_by'),
  createdAt: created(),
  updatedAt: updated(),
});

/**
 * Inbox of a network on other software: members, answers, question definitions and deletions it uploaded or
 * pushed, encrypted (they hold personal data). The panel's connector reads it in id order like a changes feed.
 */
export const networkRecords = pgTable(
  'network_record',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dataMode: dataMode('data_mode').notNull().default('live'),
    panel: text('panel')
      .notNull()
      .references(() => panels.code),
    /** member | answer | question | deletion */
    kind: text('kind').notNull(),
    sourceMemberId: text('source_member_id'),
    sourceQuestionId: text('source_question_id'),
    payloadEnc: text('payload_enc').notNull(),
    batch: text('batch').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('network_record_feed_idx').on(t.panel, t.kind, t.id)],
);

/** One upload or push. A batch id is accepted once per panel, so a retried push is not stored twice. */
export const networkBatches = pgTable(
  'network_batch',
  {
    panel: text('panel')
      .notNull()
      .references(() => panels.code),
    batch: text('batch').notNull(),
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    records: integer('records').notNull(),
    createdBy: uuid('created_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.panel, t.batch] })],
);

/** The key a network signs its pushes with (HMAC-SHA256), encrypted. Shown once when it is made. */
export const networkPushKeys = pgTable('network_push_key', {
  panel: text('panel')
    .primaryKey()
    .references(() => panels.code),
  secretEnc: text('secret_enc').notNull(),
  hint: text('hint').notNull(),
  createdBy: uuid('created_by'),
  createdAt: created(),
});

/**
 * MADP's audience segments (consumer, professionals, patients, caregivers, teens, and any a Super Admin adds). A
 * person may hold several. Built-in segments can be renamed but not deleted, and Teens always stays a minors segment.
 */
export const audienceSegments = pgTable('audience_segment', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  description: text('description').notNull().default(''),
  /** Every member is a minor: minor protections always apply. */
  minors: boolean('minors').notNull().default(false),
  builtIn: boolean('built_in').notNull().default(false),
  /** 'active' or 'archived'. An archived segment gets no new members and is hidden from filters. */
  status: text('status').notNull().default('active'),
  sort: smallint('sort').notNull().default(100),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by'),
  createdBy: uuid('created_by'),
  createdAt: created(),
  updatedAt: updated(),
});

/** A panel's own category value (User.category) and the MADP segment it joins. One value may join several. */
export const segmentRules = pgTable(
  'segment_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panel: text('panel')
      .notNull()
      .references(() => panels.code),
    /** Lower case, as the panel stores it (e.g. "b2c", "minor patient"). */
    sourceValue: text('source_value').notNull(),
    segment: text('segment')
      .notNull()
      .references(() => audienceSegments.key),
    minor: boolean('minor').notNull().default(false),
    evidence: text('evidence').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('segment_rule_key').on(t.panel, t.sourceValue, t.segment)],
);

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
    panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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
    category: text('category')
      .notNull()
      .references(() => audienceSegments.key),
    panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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
  category: text('category').references(() => audienceSegments.key),
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
    panel: text('panel').notNull().references(() => panels.code),
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
  panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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
  totpSecretEnc: text('totp_secret_enc'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  /** The 30-second step of the last accepted authenticator code; a code is accepted once (no replay). */
  totpLastStep: integer('totp_last_step'),
  isActive: boolean('is_active').notNull().default(true),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
});

/**
 * Roles are data, not code: a role is a name and a list of permission strings, so new roles are made in the console.
 * Built-in roles (`system`) are seeded by migration and cannot be deleted; super_admin cannot be edited.
 */
export const adminRoles = pgTable('admin_role', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  permissions: text('permissions')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  system: boolean('system').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
});

/** A role held by an admin on some brands. `brands` null = every brand. Admin accounts never live in panel data. */
export const adminRoleGrants = pgTable(
  'admin_role_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    roleKey: text('role_key')
      .notNull()
      .references(() => adminRoles.key),
    brands: text('brands').array(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('admin_role_grant_uq').on(t.adminId, t.roleKey),
    index('admin_role_grant_role_idx').on(t.roleKey),
  ],
);

/** Server-side admin sessions: a session ends after ADMIN_IDLE_MINUTES without a request, or on sign-out. */
export const adminSessions = pgTable(
  'admin_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    createdAt: created(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('admin_session_admin_idx').on(t.adminId)],
);

/**
 * Per-brand settings. The brand key is the panel code here and the `origin` hostname in the shared panel database;
 * `origins` lists the hostnames that belong to the brand. Money values are settings, not code.
 */
export const brandSettings = pgTable('brand_setting', {
  panel: text('panel').primaryKey().references(() => panels.code),
  displayName: text('display_name').notNull(),
  origins: text('origins').array().notNull(),
  languages: text('languages')
    .array()
    .notNull()
    .default(sql`'{en}'::text[]`),
  currency: text('currency').notNull().default('USD'),
  /** Points worth 1 unit of `currency`. Spec: 1,000 points = 1 USD while testing. */
  pointsPerCurrencyUnit: integer('points_per_currency_unit').notNull().default(1000),
  minRedemptionPoints: integer('min_redemption_points').notNull().default(15000),
  /** Money actions above this need a second admin (four eyes). Spec: 50 USD = 50,000 points. */
  fourEyesPoints: integer('four_eyes_points').notNull().default(50000),
  /** Six-month data check: months between "Still true?" reviews. */
  profileReviewMonths: smallint('profile_review_months').notNull().default(6),
  /** Months without activity before a member is archived. */
  archiveAfterMonths: smallint('archive_after_months').notNull().default(6),
  /** The brand's support address: the From and Reply-To of member e-mails, shown in e-mail previews. */
  supportEmail: text('support_email'),
  /** Legal footer of member e-mails and legal pages: the company that runs the brand. */
  legalName: text('legal_name'),
  /** Registered postal address for the legal footer. */
  postalAddress: text('postal_address'),
  /** The brand's published privacy policy. Null until Kunal confirms it. */
  privacyUrl: text('privacy_url'),
  updatedBy: uuid('updated_by'),
  updatedAt: updated(),
});

/**
 * How MADP reaches each panel, set in the console (Panel connections) instead of environment variables. Tokens and
 * secrets are field-encrypted and never returned. Any column left null falls back to the matching environment
 * value, so a stack configured through env keeps working. A change an admin proposes waits in `pending_enc` until
 * a second super admin approves it, unless no other super admin exists (then the proposer's authenticator code
 * suffices). Turning live sync on is the owner's approval to read that panel's production personal data.
 */
export const panelConnections = pgTable('panel_connection', {
  panel: text('panel').primaryKey().references(() => panels.code),
  /** Changes feeds (`/api/v1/changes/*`), read with `sync_token_enc`. */
  syncBaseUrl: text('sync_base_url'),
  syncTokenEnc: text('sync_token_enc'),
  /** Last four characters of the token, so admins can tell which one is set. */
  syncTokenHint: text('sync_token_hint'),
  /** Signed admin API (`/api/v1/admin/*`) on the shared panel backend. */
  adminBaseUrl: text('admin_base_url'),
  adminSecretEnc: text('admin_secret_enc'),
  adminSecretHint: text('admin_secret_hint'),
  /** Minutes between automatic syncs; 0 is off; null uses SYNC_INTERVAL_MINUTES. */
  syncIntervalMinutes: smallint('sync_interval_minutes'),
  liveApproved: boolean('live_approved').notNull().default(false),
  liveApprovedBy: uuid('live_approved_by'),
  liveApprovedAt: timestamp('live_approved_at', { withTimezone: true }),
  /** Proposed change waiting for a second super admin: field-encrypted JSON. */
  pendingEnc: text('pending_enc'),
  /** What the pending change touches (field names only, never values), for the screen. */
  pendingFields: text('pending_fields').array(),
  pendingBy: uuid('pending_by'),
  pendingAt: timestamp('pending_at', { withTimezone: true }),
  pendingReason: text('pending_reason'),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  lastTestOk: boolean('last_test_ok'),
  lastTestMessage: text('last_test_message'),
  updatedBy: uuid('updated_by'),
  updatedAt: updated(),
});

/**
 * Append-only and hash-chained. Triggers in the migrations reject UPDATE, DELETE and TRUNCATE, and on INSERT set
 * `prev_hash` to the previous entry's hash and `hash` to sha256 over this entry (see madp_audit_hash), so a changed
 * or missing entry breaks GET /audit/verify. Never stores raw PII: before/after values are masked.
 */
export const auditEvents = pgTable(
  'audit_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorType: text('actor_type').notNull(),
    /** Roles the actor held at the time, comma-separated. */
    actorRole: text('actor_role'),
    /**
     * Brand the action was taken in; null for cross-brand or platform actions. No foreign key: the audit trail is
     * append-only and outlives a deleted panel.
     */
    panel: text('panel'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    outcome: text('outcome').notNull().default('success'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    prevHash: text('prev_hash'),
    // Set by the insert trigger; the client value is always replaced.
    hash: text('hash')
      .notNull()
      .$defaultFn(() => ''),
  },
  (t) => [
    index('audit_event_at_idx').on(t.at),
    index('audit_event_actor_idx').on(t.actorId),
    index('audit_event_action_idx').on(t.action),
    index('audit_event_panel_idx').on(t.panel),
    index('audit_event_target_idx').on(t.targetType, t.targetId),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Engagement (Milestone 4, part 1). Templates and campaigns belong to one panel: each brand keeps its own sender,
// footer, consents and history. Nothing is sent from here yet: runs are dry runs that record what would happen.

/** A reusable message for one panel. Its content lives in versions; an approved version never changes. */
export const messageTemplates = pgTable(
  'message_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panel: text('panel').notNull().references(() => panels.code),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** welcome, newsletter, birthday, festival, reengagement, profile_recovery, survey_reminder, service. */
    kind: text('kind').notNull(),
    channel: text('channel').notNull().default('email'),
    /** Set when the template was made from a mailer pack: { pack, template, importedAt, assetHost }. */
    source: jsonb('source'),
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
  panel: text('panel').primaryKey().references(() => panels.code),
  maxPerWeek: integer('max_per_week').notNull().default(2),
  maxPerMonth: integer('max_per_month').notNull().default(6),
  /** Local hours (0-23) in the member's time zone when nothing is scheduled. */
  quietStartHour: smallint('quiet_start_hour').notNull().default(21),
  quietEndHour: smallint('quiet_end_hour').notNull().default(8),
  /** Fatigue score bands: score >= value -> band. */
  bands: jsonb('bands')
    .notNull()
    .default(sql`'{"high": 60, "medium": 30}'::jsonb`),
  updatedBy: uuid('updated_by'),
  updatedAt: updated(),
});

export const campaigns = pgTable(
  'campaign',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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
    panel: text('panel').notNull().references(() => panels.code),
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

// Loyalty (Milestone 5). Each panel keeps its own wallet: MADP mirrors it read-only, per panel membership, and
// never merges balances across panels, even for one person.

/** One wallet mirror per panel membership. */
export const loyaltyAccounts = pgTable(
  'loyalty_account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    panelMembershipId: uuid('panel_membership_id')
      .notNull()
      .references(() => panelMemberships.id),
    sourceMemberId: text('source_member_id').notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('loyalty_account_membership_key').on(t.panelMembershipId),
    uniqueIndex('loyalty_account_source_key').on(t.dataMode, t.panel, t.sourceMemberId),
  ],
);

/**
 * Append-only reward ledger (a trigger rejects updates and deletes). Each line moves `points` (signed) into one
 * bucket: pending, approved, reversed or redeemed. A source row's position is the bucket its lines leave
 * non-zero; a change at the source appends lines that move it, numbered by `seq`, so re-reading a feed never
 * books anything twice.
 */
export const rewardLedger = pgTable(
  'reward_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    accountId: uuid('account_id')
      .notNull()
      .references(() => loyaltyAccounts.id),
    /** reward (panel Rewards row) or response (panel survey Response). */
    sourceKind: text('source_kind').notNull(),
    sourceRef: text('source_ref').notNull(),
    seq: integer('seq').notNull(),
    bucket: text('bucket').notNull(),
    points: integer('points').notNull(),
    /** mirror (follows the panel) or approval (a MADP decision on a pending survey complete). */
    entryKind: text('entry_kind').notNull(),
    category: text('category').notNull(),
    /** Profile slug or survey slug. */
    reference: text('reference'),
    sourceStatus: text('source_status'),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    importJobId: uuid('import_job_id'),
    decidedBy: uuid('decided_by'),
    note: text('note'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reward_ledger_source_seq_key').on(t.dataMode, t.panel, t.sourceKind, t.sourceRef, t.seq),
    index('reward_ledger_account_idx').on(t.accountId, t.recordedAt),
    index('reward_ledger_panel_bucket_idx').on(t.dataMode, t.panel, t.bucket),
  ],
);

/** Survey responses as the panel reports them: who took which survey, the outcome and its points. */
export const surveyParticipations = pgTable(
  'survey_participation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    panelMembershipId: uuid('panel_membership_id')
      .notNull()
      .references(() => panelMemberships.id),
    sourceResponseId: text('source_response_id').notNull(),
    surveySlug: text('survey_slug'),
    status: text('status').notNull(),
    points: integer('points').notNull().default(0),
    loi: real('loi'),
    source: text('source'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('survey_participation_source_key').on(t.dataMode, t.panel, t.sourceResponseId),
    index('survey_participation_membership_idx').on(t.panelMembershipId, t.endedAt),
  ],
);

/** A reconciliation of one panel's mirrored ledger against a full read of the panel's feeds. */
export const loyaltyReconciliations = pgTable('loyalty_reconciliation', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataMode: dataMode('data_mode').notNull(),
  panel: text('panel').notNull().references(() => panels.code),
  repaired: boolean('repaired').notNull(),
  report: jsonb('report').notNull(),
  requestedBy: uuid('requested_by'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

// Supply360 (Milestone 6). A separate product that calls MADP as a signed service client. It sees counts,
// eligibility and pseudonymous references only; the tables below never hold names, addresses or answers.

export const serviceClients = pgTable(
  'service_client',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    name: text('name').notNull(),
    /** Public id sent in x-madp-client. */
    clientId: text('client_id').notNull(),
    /** HMAC signing secret, field-encrypted (shown once at creation). */
    secretEnc: text('secret_enc').notNull(),
    scopes: text('scopes').array().notNull(),
    panels: text('panels').array().notNull(),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(120),
    /** active | revoked */
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by'),
    createdAt: created(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('service_client_client_id_key').on(t.clientId)],
);

/** Nonces seen inside the timestamp window; a repeat is a replay. Old rows are pruned. */
export const serviceNonces = pgTable(
  'service_nonce',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => serviceClients.id),
    nonce: text('nonce').notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('service_nonce_key').on(t.clientId, t.nonce),
    index('service_nonce_seen_idx').on(t.seenAt),
  ],
);

export const serviceIdempotency = pgTable(
  'service_idempotency',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => serviceClients.id),
    key: text('key').notNull(),
    route: text('route').notNull(),
    requestHash: text('request_hash').notNull(),
    status: integer('status').notNull(),
    response: jsonb('response').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('service_idempotency_key').on(t.clientId, t.key)],
);

/**
 * A pseudonymous reference to one panel membership, for one service client. Random, so references cannot be
 * linked across clients or back to a person without MADP.
 */
export const serviceReferences = pgTable(
  'service_reference',
  {
    ref: text('ref').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => serviceClients.id),
    dataMode: dataMode('data_mode').notNull(),
    panelMembershipId: uuid('panel_membership_id')
      .notNull()
      .references(() => panelMemberships.id),
    createdAt: created(),
  },
  (t) => [uniqueIndex('service_reference_member_key').on(t.clientId, t.panelMembershipId)],
);

export const audienceReservations = pgTable(
  'audience_reservation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => serviceClients.id),
    projectRef: text('project_ref').notNull(),
    /** active | released | expired */
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: created(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [index('audience_reservation_client_idx').on(t.clientId, t.projectRef)],
);

export const reservationMembers = pgTable(
  'reservation_member',
  {
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => audienceReservations.id),
    panelMembershipId: uuid('panel_membership_id')
      .notNull()
      .references(() => panelMemberships.id),
    ref: text('ref').notNull(),
  },
  (t) => [
    uniqueIndex('reservation_member_key').on(t.reservationId, t.panelMembershipId),
    index('reservation_member_membership_idx').on(t.panelMembershipId),
  ],
);

/** A survey invitation MADP authorised for one member of a reservation. Its status follows participation events. */
export const surveyInvitations = pgTable(
  'survey_invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    panelMembershipId: uuid('panel_membership_id')
      .notNull()
      .references(() => panelMemberships.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => serviceClients.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => audienceReservations.id),
    projectRef: text('project_ref').notNull(),
    ref: text('ref').notNull(),
    /** authorized, then the latest participation event (click, start, complete, terminate, ...). */
    status: text('status').notNull().default('authorized'),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }).notNull().defaultNow(),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('survey_invitation_member_key').on(t.reservationId, t.panelMembershipId),
    index('survey_invitation_membership_idx').on(t.panelMembershipId),
  ],
);

export const participationEvents = pgTable(
  'participation_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => serviceClients.id),
    eventId: text('event_id').notNull(),
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => surveyInvitations.id),
    event: text('event').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: created(),
  },
  (t) => [
    uniqueIndex('participation_event_key').on(t.clientId, t.eventId),
    index('participation_event_invitation_idx').on(t.invitationId),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Consent and preference center (spec §11, screen 14). consent_record keeps the current state that the panel
// reports. consent_event is its append-only history, written by a database trigger on every change, so the
// evidence of each grant or withdrawal outlives later syncs. contact_preference holds channel opt-outs that a
// member asked MADP for directly. MADP never grants consent itself: only the panel can.

export const consentEvents = pgTable(
  'consent_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dataMode: dataMode('data_mode').notNull(),
    /** No foreign key: the history is kept as evidence even if the person is later merged or erased. */
    masterPersonId: uuid('master_person_id').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    purpose: text('purpose').notNull(),
    previousStatus: consentStatus('previous_status'),
    status: consentStatus('status').notNull(),
    evidence: jsonb('evidence').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('consent_event_person_idx').on(t.masterPersonId, t.panel),
    index('consent_event_at_idx').on(t.dataMode, t.panel, t.at),
  ],
);

export const contactPreferences = pgTable(
  'contact_preference',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    /** Per panel membership, so the preference follows the account through identity merges and unmerges. */
    panelMembershipId: uuid('panel_membership_id')
      .notNull()
      .references(() => panelMemberships.id),
    panel: text('panel').notNull().references(() => panels.code),
    /** email, sms, push, whatsapp, or all. */
    channel: text('channel').notNull(),
    /** opted_out, or resumed (lifts an earlier MADP opt-out only; it never grants panel consent). */
    status: text('status').notNull(),
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contact_preference_membership_idx').on(t.panelMembershipId, t.channel, t.recordedAt)],
);

// ---------------------------------------------------------------------------------------------------------------
// Privacy requests (spec §11, screen 15): access, correction, deletion and restriction, with due dates and an
// append-only trail. Panels own the member record, so MADP erases its own copy, holds the member out of later
// syncs, and tracks the panel's own deletion until its deletions feed confirms it.

export const privacyRequests = pgTable(
  'privacy_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    masterPersonId: uuid('master_person_id').notNull(),
    /** access, correction, deletion, restriction. */
    kind: text('kind').notNull(),
    panels: text('panels').array().notNull(),
    /** received, verified, completed, rejected. Deletion also passes awaiting_panel. */
    status: text('status').notNull().default('received'),
    /** Where it came from, e.g. a ticket number. No personal data. */
    reference: text('reference').notNull(),
    jurisdiction: text('jurisdiction'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').notNull(),
    verifiedBy: uuid('verified_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    result: jsonb('result')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('privacy_request_status_idx').on(t.dataMode, t.status, t.dueAt),
    index('privacy_request_person_idx').on(t.masterPersonId),
  ],
);

export const privacyRequestEvents = pgTable(
  'privacy_request_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => privacyRequests.id),
    action: text('action').notNull(),
    actorId: uuid('actor_id'),
    note: text('note').notNull().default(''),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('privacy_request_event_request_idx').on(t.requestId, t.at)],
);

/** Members erased in MADP on request: later syncs skip them until the panel has deleted them too. */
export const erasureHolds = pgTable(
  'erasure_hold',
  {
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    sourceMemberId: text('source_member_id').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => privacyRequests.id),
    createdAt: created(),
    panelDeletedAt: timestamp('panel_deleted_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.dataMode, t.panel, t.sourceMemberId] })],
);

/**
 * Independent verification of a member's claim (screen 8): one admin records the check, another decides it. Holds no
 * personal data; `reference` points to where the proof is kept. Erased with the membership on a privacy deletion.
 */
export const verificationEvidence = pgTable(
  'verification_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    /** The person comes from the membership, so identity merges and unmerges carry the evidence with them. */
    panelMembershipId: uuid('panel_membership_id')
      .notNull()
      .references(() => panelMemberships.id),
    panel: text('panel').notNull().references(() => panels.code),
    /** identity, age, hcp_licence, employment. */
    claim: text('claim').notNull(),
    method: text('method').notNull(),
    reference: text('reference').notNull(),
    /** pending, verified, rejected, revoked. */
    status: text('status').notNull().default('pending'),
    expiresOn: date('expires_on'),
    recordedBy: uuid('recorded_by').notNull(),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('verification_evidence_status_idx').on(t.dataMode, t.panel, t.status),
    index('verification_evidence_membership_idx').on(t.panelMembershipId),
  ],
);

/**
 * Rule-based insights (screen 34), one open row per data mode, panel and rule. Counts only. A person accepts or
 * dismisses each one; a refresh resolves open insights whose rule no longer fires.
 */
export const insights = pgTable(
  'insight',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    rule: text('rule').notNull(),
    /** info, warning, critical. */
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    recommendation: text('recommendation').notNull(),
    /** Where to act, an admin path such as /identity. */
    link: text('link'),
    evidence: jsonb('evidence').notNull(),
    /** open, accepted, dismissed, resolved. */
    status: text('status').notNull().default('open'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
  },
  (t) => [
    uniqueIndex('insight_open_uq')
      .on(t.dataMode, t.panel, t.rule)
      .where(sql`status = 'open'`),
    index('insight_status_idx').on(t.dataMode, t.status, t.lastSeenAt),
  ],
);

/**
 * Questionnaire builder drafts (spec screens 11 and 12): a change to one panel profile's pages and show logic, held
 * in MADP until a second admin approves it, then written to the panel through its admin API. `base` is the profile
 * as it was when the draft started, so the reviewer sees what changes and apply can refuse a profile that moved on.
 * No member data: questions, options and pages only.
 */
export const questionnaireDrafts = pgTable(
  'questionnaire_draft',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dataMode: dataMode('data_mode').notNull(),
    panel: text('panel').notNull().references(() => panels.code),
    category: text('category').notNull(),
    slug: text('slug').notNull(),
    profileId: text('profile_id').notNull(),
    note: text('note'),
    base: jsonb('base').notNull(),
    spec: jsonb('spec').notNull(),
    /** draft -> review -> approved | rejected; approved -> applied. draft or review -> discarded. */
    status: text('status').notNull().default('draft'),
    createdBy: uuid('created_by').notNull(),
    submittedBy: uuid('submitted_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    appliedBy: uuid('applied_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    /** What apply wrote, step by step, and the panel version it opened. */
    applyResult: jsonb('apply_result'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('questionnaire_draft_panel_idx').on(t.dataMode, t.panel, t.status),
    // One open draft per profile, so two admins don't overwrite each other's work.
    uniqueIndex('questionnaire_draft_open_uq')
      .on(t.dataMode, t.panel, t.category, t.slug)
      .where(sql`status in ('draft', 'review', 'approved')`),
  ],
);

/**
 * When each admin last marked a panel's new sign-ups as seen. The console's new-member bell counts members MADP
 * learned about after this moment. No panel data is kept here, so there is no data_mode.
 */
export const adminNewMemberSeen = pgTable(
  'admin_new_member_seen',
  {
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    panel: text('panel')
      .notNull()
      .references(() => panels.code),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adminUserId, t.panel] })],
);

/**
 * Saved views of the Members table: a name plus list filters and sort, per brand. Filters only (never a search for one
 * person), so no panel data is kept and there is no data_mode.
 */
export const memberSavedViews = pgTable(
  'member_saved_view',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panel: text('panel')
      .notNull()
      .references(() => panels.code),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    params: jsonb('params').notNull(),
    shared: boolean('shared').notNull().default(false),
    createdAt: created(),
  },
  (t) => [index('member_saved_view_panel_idx').on(t.panel, t.adminUserId)],
);

/**
 * The Members table's "Type" column rules of one brand (which question-bank answers show for which panel
 * category: B2B designation, HCP type, caregiver type, patient condition...). Settings only, no panel data, so no
 * data_mode. A brand with no row uses the defaults in code.
 */
export const memberTypeRules = pgTable('member_type_rules', {
  panel: text('panel')
    .primaryKey()
    .references(() => panels.code),
  rules: jsonb('rules').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: updated(),
});

/**
 * Admin tags on panel members ("VIP", "check payout", ...), per brand. The member is the panel's own id. A tag is a
 * label, not personal data, but it is about a panel member, so it carries data_mode.
 */
export const memberTags = pgTable(
  'member_tag',
  {
    panel: text('panel')
      .notNull()
      .references(() => panels.code),
    memberId: text('member_id').notNull(),
    tag: text('tag').notNull(),
    dataMode: dataMode('data_mode').notNull(),
    createdBy: uuid('created_by'),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.panel, t.dataMode, t.memberId, t.tag] }),
    index('member_tag_by_tag_idx').on(t.panel, t.dataMode, t.tag),
  ],
);

/** Admin notes on a panel member. Free text may hold personal data: reads are audited, only the author deletes. */
export const memberNotes = pgTable(
  'member_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    panel: text('panel')
      .notNull()
      .references(() => panels.code),
    memberId: text('member_id').notNull(),
    dataMode: dataMode('data_mode').notNull(),
    body: text('body').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    createdBy: uuid('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [index('member_note_member_idx').on(t.panel, t.dataMode, t.memberId)],
);
