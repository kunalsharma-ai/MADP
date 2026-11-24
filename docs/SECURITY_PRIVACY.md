# Security and privacy

Status legend: **Implemented** (in code and tested), **Planned** (milestone given). Legal applicability (India's DPDP
Act 2023, GDPR and UK GDPR) has to be confirmed by counsel. Nothing here is legal advice.

## 1. Controls implemented in Milestone 1
| Control | Where | Test |
|---|---|---|
| Argon2id password hashing | `auth.service.ts` | `requires TOTP once MFA is enabled, and locks after repeated failures` |
| Lockout after 5 failed logins for 15 minutes | `auth.service.ts` | same test |
| TOTP MFA, required by default (`REQUIRE_MFA=true`); unenrolled users only get an `mfa_setup` token | `auth.service.ts`, `auth.guard.ts` | `a session that has not enrolled MFA can only reach MFA enrolment` |
| RBAC: six roles, permissions per route | `auth/permissions.ts`, `@RequirePermissions` | `rejects anonymous access to every data endpoint`, `analysts cannot open the panellist directory…` |
| ABAC: PII decrypted only with `panellists.pii.read`; MHO special-category answers only with `health.sensitive.read` | `panellists.controller.ts` | `…stewards see masked data and no health answers`, `a super admin sees decrypted PII and health answers…` |
| Field encryption, AES-256-GCM, versioned key id (`k1.`), tamper detection | `crypto/field-crypto.ts` | `round-trips and never repeats ciphertext`, `detects tampering` |
| No PII in Mongo staging events | `ingestion.service.ts` | `PII never lands in MongoDB staging events` |
| Direct identifiers (name, e-mail, phone, date of birth, postcode) are never requested or stored as profile answers | `ingestion/canonical.ts#DIRECT_IDENTIFIER_QUESTIONS` | `never stores contact details as profile answers…` |
| Keyed HMAC e-mail hash for matching and exact search; no plaintext e-mail index | `field-crypto.ts` | `exact e-mail search uses the keyed hash` |
| Masked identifiers in lists | `maskEmail` | `masks e-mails` |
| Append-only audit, enforced by a database trigger that rejects UPDATE, DELETE and TRUNCATE | `drizzle/0001_audit_append_only.sql` | `rejects UPDATE and DELETE on audit_event` |
| Every panellist detail view is audited | `panellists.controller.ts` | `…and the view is audited` |
| Special-category attribute filters need `health.sensitive.read`; each use is audited | `audience.service.ts`, `audience.controller.ts` | `special-category filters need health.sensitive.read, and their use is audited` |
| Dead-letter rows hold source member ids and the error only; the list API returns counts, not ids | `ingestion.service.ts`, `connectors.controller.ts` | `parks an answer batch that keeps failing…` |
| Minimum cell suppression on counts | `audience.service.ts` | `filters by panel and category and suppresses small cells` |
| DEMO and LIVE separation on every row | `data_mode` column | `counts unique people separately from panel and category memberships` |
| LIVE connectors locked until explicitly approved per panel | `connector-registry.ts` | `all connectors start in DEMO mode because live access is not approved`; config `defaults to no live source access` |
| Connector refuses a base URL whose host differs from the tenant host | `http-connector.ts` | `refuses a base URL whose host is not the tenant host` |
| Helmet security headers on the API; X-Frame-Options DENY, nosniff, referrer and permissions policy on the admin app (a nonce-based CSP is planned for M2) | `bootstrap.ts`, `next.config.ts` | not automated |
| Rate limiting: 300 requests per minute globally, 10 per minute on login and MFA confirm | `app.module.ts`, `auth.controller.ts` | not automated |
| Secrets come only from env; startup fails if a secret is missing or too short | `packages/config` | `requires a strong signing secret`, `requires MFA unless explicitly disabled` |
| `.env` is git-ignored; only `.env.example` with placeholders is committed | `.gitignore` | not automated |
| Field-key rotation: several keys by id, one active; `keys:rotate` re-encrypts every encrypted column in batches, can be stopped and re-run, and is audited. A value on a retired key fails loudly | `crypto/field-crypto.ts`, `crypto/key-rotation.service.ts` | `rotates: old values stay readable…`, `re-encrypts every value to the new key…` |
| Signed webhooks: HMAC-SHA256 over timestamp, event id and raw body; 5-minute replay window; event id idempotency; several secrets for rotation; payload limited to type and time (no personal data), only its hash is stored; rejections audited | `webhooks/` | `test/webhooks.test.ts`, `src/webhooks/signature.test.ts` |

## 2. Sensitive data (MHO)
- Every MHO answer is `special_category` unless its question is on a short demographic allow-list
  (`ingestion/canonical.ts#sensitivityFor`).
- Membership in MHO never implies a health condition. The `patient` category comes only from the source category the
  member chose, and MADP never infers a diagnosis.
- Minors: `minor` and `minor patient` set `is_minor=true`. Minor records must not be used for engagement until the
  guardian consent rules are confirmed (M3).
- Guardian consent is synced as a status only (`consent_record`, purpose `guardian_consent`). The guardian's name,
  e-mail, phone, IP address, onboarding answers and the full consent record stay on the panel; the evidence column
  holds only the source field, its status value, the consent version and the import job.
- **Purpose before access.** `health.sensitive.read` alone no longer shows health answers. The viewer also states a
  purpose (`participant_support`, `data_quality_review`, `privacy_request`, `study_feasibility`), and the audit
  event records it. The same applies to counts that use a special-category filter (`purpose` in the request).
- **Minors.** A minor's health answers from a panel stay hidden, even with the permission and a purpose, until that
  panel's guardian consent is `granted`.
- **Larger minimum cell.** Counts narrowed by a special-category filter suppress cells below
  `SENSITIVE_MIN_CELL_SIZE` (default 10) instead of `MIN_CELL_SIZE` (default 5).
- Tests: `apps/api/test/mho-controls.test.ts`, `attributes.test.ts`, `platform.test.ts`.
- Health answers will never be sent to Supply360 (spec §5). The planned Supply360 contract exposes only
  privacy-thresholded counts and eligibility flags.

## 3. Planned controls
| Control | Milestone |
|---|---|
| Consent population from each panel's `User` fields (done, DEMO); answer-based consent (MFR); consent check API | M3 |
| Deletion propagation (source event → MADP → downstream), with deletion receipts | M3 |
| KMS-backed keys, and rotation of `PII_HASH_KEY` (needs every e-mail re-hashed) | M3 |
| Access reviews and break-glass procedure | M3 |
| Outbound sending through a provider, with credentials kept in a vault (policy, suppression and quiet hours are built and dry-run only) | M4 |
| Signed service auth for Supply360 (client credentials plus request signing), scoped per service client | M6 |
| Dependency and container scanning, backups and restore drills, incident runbook | M6 |

## 3a. Key rotation
1. Generate a key (`openssl rand -base64 32`) and add it as `FIELD_ENCRYPTION_KEYS=k2=<key>`. Keep
   `FIELD_ENCRYPTION_KEY` (that is `k1`).
2. Set `FIELD_ENCRYPTION_ACTIVE_KEY=k2` and restart every API instance. New values are encrypted with `k2`; `k1`
   values stay readable.
3. Run `pnpm --filter @madp/api keys:rotate`. `--status` shows how many values each key still holds.
4. When `remaining` is 0, no stored value uses `k1` any more. `FIELD_ENCRYPTION_KEY` is still required at start-up,
   but it no longer protects any data, so the old key material can be destroyed and replaced with a fresh value.

Webhook secrets rotate the same way: list the new secret next to the old one, switch the panel to the new one, then
drop the old one.

## 4. Live-access approval process (nothing has been accessed)
MADP will not read real personal data until **all** of these are true for a panel:
1. Kunal approves read-only access for that panel in writing in this project. ✅ Given 2026-11-23 for all three.
2. The panel owner issues a scoped, revocable integration credential (gap G-01). MADP will not use the T2O `/user/apps`
   login, a person's admin JWT, a database dump or direct database access.
3. The credential is placed in secure configuration (an environment secret), never in chat, git or a prompt.
4. The production origin host is confirmed (G-04), and the panel is added to `LIVE_SOURCE_APPROVED_PANELS`.
5. A **dry run** is executed first and its counts are reviewed before a real import.

## 5. Findings in the source panels (from the code audit; not exploited, not tested live)
These sit outside MADP's code, but they affect the data MADP would ingest. Because MFR and MHO production run the
T2O backend, **every T2O finding applies to all three panels**, including MHO's health data. Fixing them needs the panel owner's
approval, and MADP has changed nothing in the panel repos.

| ID | Severity | Finding |
|---|---|---|
| T2O-SEC-01 | Critical | `POST /api/v1/user/apps` returns a 365-day root JWT for any request that matches an app user's fields. No secret is checked |
| T2O-SEC-07 | Critical | `GET /api/v1/integration/respondent-profile/:respondentID` returns a member's record and all profile answers without authentication |
| T2O-SEC-02 | Critical | `GET /api/v1/user/birthday/today` returns names and e-mails without authentication |
| T2O-SEC-03 | High | Any signed-in member can list members (including teens' guardian e-mails) and read others' answers. The request body is used as a raw Mongo filter. Reproduced on a running copy, 2026-11-23 |
| T2O-BUG-01 | High | OTP unique index uses a field that does not exist, so a guardian's consent fails part-way and the teen gets no activation link. Reproduced on a running copy |
| T2O-SEC-04, MFR-SEC-01, MHO-SEC-02 | High | Question and option write routes have no authentication |
| MHO-SEC-01 | High | `isAdmin` throws an undefined `HttpError`, so non-admin requests crash instead of getting 403 |
| MHO-SEC-03 | Medium | MHO production runs the T2O backend image, so this repo's code is not what serves health data |
| T2O-SEC-05 | Medium | Profile completion aggregation does not filter by tenant |
| T2O-SEC-06 | Medium | `sync.sh` copies a production dump into local development |
| MFR-SEC-02 | Medium | No scoped service credentials; admin tokens are 7-day member JWTs |
| MHO-SEC-04 | Medium | Log paths are committed; confirm no personal data is written there |

MFR's November 2026 access lock-down (`utils/access.js`) is a good template for fixing T2O-SEC-03 and MHO-SEC-01.
