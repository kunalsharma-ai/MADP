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

## 2. Sensitive data (MHO)
- Every MHO answer is `special_category` unless its question is on a short demographic allow-list
  (`ingestion/canonical.ts#sensitivityFor`).
- Membership in MHO never implies a health condition. The `patient` category comes only from the source category the
  member chose, and MADP never infers a diagnosis.
- Minors: `minor patient` sets `is_minor=true`. Minor records must not be used for engagement until the guardian
  consent rules are confirmed (M3).
- Health answers will never be sent to Supply360 (spec §5). The planned Supply360 contract exposes only
  privacy-thresholded counts and eligibility flags.

## 3. Planned controls
| Control | Milestone |
|---|---|
| Purpose-specific consent population from each panel; consent check API | M3 |
| Deletion propagation (source event → MADP → downstream), with deletion receipts | M3 |
| Reversible merge and unmerge with review | M3 |
| Key rotation job (re-encrypt `k1` → `k2`) and a KMS-backed key | M3 |
| Access reviews and break-glass procedure | M3 |
| Outbound messaging policy, suppression, quiet hours, provider credentials kept in a vault | M4 |
| Signed service auth for Supply360 (client credentials plus request signing), scoped per service client | M6 |
| Dependency and container scanning, backups and restore drills, incident runbook | M6 |

## 4. Live-access approval process (nothing has been accessed)
MADP will not read real personal data until **all** of these are true for a panel:
1. Kunal approves read-only access for that panel in writing in this project.
2. The panel owner issues a scoped, revocable integration credential (gap G-01). MADP will not use the T2O `/user/apps`
   login, a person's admin JWT, a database dump or direct database access.
3. The credential is placed in secure configuration (an environment secret), never in chat, git or a prompt.
4. The production origin host is confirmed (G-04), and the panel is added to `LIVE_SOURCE_APPROVED_PANELS`.
5. A **dry run** is executed first and its counts are reviewed before a real import.

## 5. Findings in the source panels (from the code audit; not exploited, not tested live)
These sit outside MADP's code, but they affect the data MADP would ingest. Fixing them needs the panel owner's
approval, and MADP has changed nothing in the panel repos.

| ID | Severity | Finding |
|---|---|---|
| T2O-SEC-01 | Critical | `POST /api/v1/user/apps` returns a 365-day root JWT for any request that matches an app user's fields. No secret is checked |
| T2O-SEC-07 | Critical | `GET /api/v1/integration/respondent-profile/:respondentID` returns a member's record and all profile answers without authentication |
| T2O-SEC-02 | Critical | `GET /api/v1/user/birthday/today` returns names and e-mails without authentication |
| T2O-SEC-03 | High | Any signed-in member can list members and read others' answers. The request body is used as a raw Mongo filter |
| T2O-SEC-04, MFR-SEC-01, MHO-SEC-02 | High | Question and option write routes have no authentication |
| MHO-SEC-01 | High | `isAdmin` throws an undefined `HttpError`, so non-admin requests crash instead of getting 403 |
| MHO-SEC-03 | Medium | MHO production runs the T2O backend image, so this repo's code is not what serves health data |
| T2O-SEC-05 | Medium | Profile completion aggregation does not filter by tenant |
| T2O-SEC-06 | Medium | `sync.sh` copies a production dump into local development |
| MFR-SEC-02 | Medium | No scoped service credentials; admin tokens are 7-day member JWTs |
| MHO-SEC-04 | Medium | Log paths are committed; confirm no personal data is written there |

MFR's November 2026 access lock-down (`utils/access.js`) is a good template for fixing T2O-SEC-03 and MHO-SEC-01.
