# API contracts

Base path `/api/v1`. All endpoints except `health` and `openapi.json` need `Authorization: Bearer <session token>` with
MFA completed. The machine-readable document is served at `GET /api/v1/openapi.json`, generated from the zod schemas in
`packages/contracts` (`apps/api/src/common/openapi.ts`). Envelope: plain JSON. Errors use Nest's
`{statusCode, message}`.

## 1. Implemented (Milestone 1, covered by `apps/api/test/platform.test.ts`)

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /health` | public | Liveness plus Postgres and Mongo reachability |
| `GET /openapi.json` | public | OpenAPI document |
| `POST /auth/login` `{email, password, totp?}` | public, 10/min | Returns a session token, or an `mfa_setup` token if MFA is not enrolled |
| `GET /auth/me` | any session | Current user and permissions |
| `POST /auth/mfa/setup` | `mfa_setup` token | Returns the otpauth URI |
| `POST /auth/mfa/confirm` `{totp}` | `mfa_setup` token, 10/min | Enables MFA and returns a full session |
| `GET /dashboard/summary` | `dashboard.read` | Counts, connector modes, KPIs (verified, multi-panel, new in 30 days, pending mappings and matches), questions and answers per panel |
| `POST /audience/counts` `CountsRequest` | `audience.counts.read` (+ `health.sensitive.read` for special-category attributes) | `CountsResponse`: unique people, memberships, category memberships, per panel/category/country cells with suppression and freshness; `attributes` filters resolve through approved mappings and are reported in `attributeFilters`; a special-category filter needs `purpose` and uses `SENSITIVE_MIN_CELL_SIZE` |
| `GET /audience/attributes` | `questions.read` | Canonical attribute definitions |
| `GET /panellists?panel&category&country&search&after&limit` | `panellists.read` | Keyset-paged list with masked identifiers; `search` is an exact member id or an exact e-mail (keyed hash) |
| `GET /panellists/:id?purpose` | `panellists.read` | 360 view. PII needs `panellists.pii.read`. Special-category answers need `health.sensitive.read` and a `purpose` (`HealthAccessPurpose`); a minor's need granted guardian consent on that panel. `access.healthPurposeRequired` says when a purpose would open them. Audited with the purpose |
| `GET /questions?panel&search` | `questions.read` | Question registry with versions and sensitivity |
| `GET /questions/:panel/:sourceQuestionId` | `questions.read` | Version history and options |
| `GET /mappings/review?panel&status` | `mappings.review` | Mapping review queue |
| `POST /mappings/:id/decision` `{decision: approve\|reject\|needs_info, attributeKey?, valueMap?, notes?}` | `mappings.review` | Records a decision. `valueMap` keys must be options of that question version. Audited |
| `GET /integrations/health` | `connectors.read` | Per-panel mode (DEMO or LIVE), health, capabilities |
| `GET /connectors` | `connectors.read` | Connector detail with the audited capability evidence |
| `GET /imports` | `connectors.read` | Import job history and reconciliation counts |
| `POST /connectors/:panel/import` `{dryRun}` (default `true`) | `imports.run` | Runs an import for one panel. Audited |
| `GET /sync-checkpoints` | `connectors.read` | Cursor and last success per panel and stream |
| `GET /imports/:id/reconciliation` | `connectors.read` | Source vs MADP counts and pass/fail checks for one run |
| `GET /dead-letters?panel&status` | `connectors.read` | Parked answer batches (member count, not ids) |
| `POST /connectors/:panel/dead-letters/retry` | `imports.run` | Re-reads open batches; resolves those that succeed. Audited |
| `POST /connectors/:panel/sync` | `imports.run` | One automatic-sync run now: only what changed since the last run (members with consent, answers, deletions). 409 while an import or sync of that panel runs. Audited. Covered by `apps/api/test/sync.test.ts` |
| `GET /sync-status` | `connectors.read` | Per panel: scheduled or not, interval, feed checkpoints, last run and its counts, parked answer batches |
| `GET /audit?before&limit` | `audit.read` | Audit events, newest first |
| `GET /identity/candidates?status&panel&limit` | `identity.review` | Cross-panel match candidates with masked e-mails and the other accounts of the candidate person. Audited. Covered by `apps/api/test/identity.test.ts` |
| `POST /identity/candidates/:id/decision` `{decision: approve\|reject, reason?}` | `identity.review` | Approve merges the account into the candidate person (409 if already decided, or if that person already has a live membership on the same panel). Audited |
| `POST /identity/source-identities/:id/unlink` `{reason}` | `identity.review` | Unmerges one panel account: back to its previous person if that is still empty, otherwise to a new one. Works for automatic links too. Audited |
| `GET /identity/persons/:id/history` | `identity.review` | Merge and unmerge events (append only) |
| `POST /webhooks/:panel` (signed, see `packages/contracts/src/webhooks.ts`) | public, HMAC signature | 202 `accepted` or `duplicate`; starts a sync of that panel. 401 on a bad signature or a stale timestamp, 400 if the body has anything but `type` and `occurredAt`, 404 when the panel has no webhook secret. Covered by `apps/api/test/webhooks.test.ts` |
| `GET /communications/templates?panel` · `POST /communications/templates` | `communications.read` · `communications.manage` | Templates per panel with their versions, and the brand kits (unconfirmed until each panel owner supplies them) |
| `POST /communications/templates/:id/versions` `{subject, bodyHtml, bodyText, language?}` | `communications.manage` | New draft version; returns the template checks (`problems`) |
| `POST /communications/template-versions/:id/submit` · `…/review` `{decision, note?}` | `communications.manage` · `communications.approve` | Review needs the checks to pass and someone other than the author |
| `GET /communications/template-versions/:id/preview` | `communications.read` | Renders with sample values only |
| `GET`/`PUT /communications/policies/:panel` | `communications.read` / `communications.approve` | Frequency caps, quiet hours, fatigue bands |
| `GET`/`POST /communications/campaigns` · `POST …/:id/decision` `{approve\|pause\|resume\|archive}` | `communications.read` · `communications.manage` · `communications.approve` | Campaigns need an approved version and a second person's approval |
| `POST /communications/campaigns/:id/run` `{dryRun}` | `communications.manage` | Dry run only (`dryRun: false` is 403): per member, planned with a send time outside quiet hours, or suppressed with a reason. Covered by `apps/api/test/engagement.test.ts` |
| `GET`/`POST /communications/calendar` · `POST …/:id/review` `{decision, note?}` | `communications.read` · `communications.manage` · `communications.approve` | Celebration dates per panel (`civic` or `religious_cultural`), reviewed by someone other than the author |
| `GET`/`POST /communications/automations` · `GET …/:id` | `communications.read` · `communications.manage` | Automations with their versions and runs. Create takes `panel, name, trigger, config, steps` (see `packages/contracts/src/automation.ts`); 400 with `problems` when a template or calendar date does not fit |
| `POST /communications/automations/:id/versions` · `POST /communications/automation-versions/:id/restore` | `communications.manage` | New draft version, or a rollback copy of an earlier one |
| `POST /communications/automation-versions/:id/submit` · `…/review` `{decision, note?}` | `communications.manage` · `communications.approve` | Review needs approved templates (and calendar date) and someone other than the author. Approving makes the version current |
| `POST /communications/automations/:id/decision` `{pause\|resume\|archive}` | `communications.approve` | |
| `POST /communications/automations/:id/run` `{dryRun, asOf?}` | `communications.manage` | Dry run only (`dryRun: false` is 403), as of now or `asOf`: per member, the step due and planned send time, or the reason it stops. Covered by `apps/api/test/automations.test.ts` |
| `GET /communications/timeline/:personId?panel&includeDryRuns&limit` | `communications.read` | Per-person timeline and a per-panel contact-load score with its factors. Audited |
| `GET /loyalty/liability?panel` | `loyalty.read` | Points per panel and bucket (approved, pending, reversed, redeemed), approved by category, pending by survey, last mirror times. Never summed across panels |
| `GET /loyalty/persons/:personId` | `loyalty.read` | One wallet per panel membership with its latest ledger lines and survey outcomes. Audited |
| `POST /loyalty/:panel/survey-approvals` `{surveySlug, note}` | `loyalty.approve` | Records the client's approval: that survey's pending completes move to approved in MADP's ledger only. 409 when none is pending |
| `POST /loyalty/:panel/sync` | `loyalty.reconcile` | Reads the rewards and responses feeds from their checkpoints (also runs after every import and sync) |
| `POST /loyalty/:panel/reconcile` `{repair}` · `GET /loyalty/reconciliations?panel` | `loyalty.reconcile` · `loyalty.read` | Full read compared with the ledger; repair books the differences. Covered by `apps/api/test/loyalty.test.ts` |
| `GET /webhooks/inbox?panel` | `connectors.read` | Which panels have webhooks on, received and open counts, last 100 events (type and times only) |

## 2. Source panel endpoints MADP calls (verified in source, not live)
Defined once in `packages/connectors/src/http-connector.ts` (`ENDPOINTS`). The base URL host must equal the panel's
tenant host, because each panel resolves its tenant from the `Host` header.

| Purpose | T2O | MFR | MHO |
|---|---|---|---|
| Questionnaires | `GET /api/v1/profile` | same | same |
| Questions | `GET /api/v1/question` | same | same |
| Options | `GET /api/v1/option/:question` | same | same |
| Respondents | `POST /api/v1/user` `{}` | same | same |
| Answers | `GET /api/v1/user/:id/profile` | same | same |
| Changed members | `GET /api/v1/changes/members?cursor&since&limit` (turn2opinion#20, not deployed) | same | same |
| Changed answers | `GET /api/v1/changes/answers?cursor&since&limit` (turn2opinion#20, not deployed) | same | same |
| Deletions | `GET /api/v1/changes/deletions?cursor&since&limit` (turn2opinion#20, not deployed) | same | same |
| Rewards and survey responses | `GET /api/v1/changes/rewards` and `/changes/responses` (turn2opinion#24, not deployed) | same | same |

All three panels run the T2O backend in production (confirmed 2026-11-23), so they share one endpoint map; only the
host differs. MADP never requests direct identifiers (name, e-mail, phone, date of birth, postcode) as answers.

## 3. Proposed non-breaking additions to the panels

**Changed-since feeds: built as kunalsharma-ai/turn2opinion#20 (draft, not deployed).** Admin-only and read-only.
Each answers `{status, data: {items, cursor, more}}`, ordered by `(updatedAt, _id)`; records from the last 5 s wait
for the next call. Mounted at `/api/v1/changes` because `/api/v1/integration` is already used by survey integrations.

```
GET /api/v1/changes/members    ≤500  → items: member record (no guardian details, password or role), incl. isActive, isDeleted, parent consent status
GET /api/v1/changes/answers    ≤1000 → items: {_id, user, question, answer: string[], updatedAt}; contact-detail questions left out
GET /api/v1/changes/deletions  ≤1000 → items: {_id, kind: "member" | "answers", user, at}  (Tombstone written by admin delete and refresh)
GET /api/v1/changes/rewards    ≤1000 → items: {_id, user, category, points, title, status, profile, createdAt, updatedAt}
GET /api/v1/changes/responses  ≤1000 → items: {_id, user, survey, status, points, loi, source, startedAt, endedAt, isDeleted, createdAt, updatedAt}
```

MADP reads them in `IngestionService.runSync` (members, then answers, then deletions, each from its own
`sync_checkpoint` stream `changes.*`). A backend without them answers 404; MADP then reports the sync as not
supported and asks again an hour later.

Still proposals (not built):

```
POST /api/v1/integration/token            client_credentials → 15-minute JWT, scopes: profile:read users:read answers:read
Webhooks (panel → MADP)                    POST {madp}/api/v1/webhooks/{panel}
  headers: X-Panel-Signature: sha256=HMAC(secret, timestamp + "." + body), X-Panel-Timestamp, X-Idempotency-Key
  events:  member.created, member.updated, member.deleted, consent.changed, answer.updated
```

MADP's side of the webhooks (the inbox table and replay protection) has a schema but no route yet (M3).

## 4. Supply360 contract (spec §12): implemented on DEMO data (2026-11-24)

Supply360 is a separate product. It calls MADP as a service client under `/api/v1/supply360/...`. It never gets
names, e-mail addresses, phone numbers, answers or health data: only counts, eligibility and pseudonymous refs
(`ref_...`), which are random, stored by MADP, and different for each client.

**Signing.** Every request carries `x-madp-client`, `x-madp-timestamp` (unix seconds, refused when more than 300 s
off), `x-madp-nonce` (8–64 chars, accepted once) and
`x-madp-signature: v1=<hex HMAC-SHA256(secret, "<ts>.<nonce>.<METHOD>.<path>.<sha256 hex of raw body>")>`. Each client
has scopes, allowed panels and a per-minute rate limit. Every refusal is audited as `service.rejected` with its
reason. Writes take an optional `idempotency-key`: the same key and body return the first answer, another body is
409. Admin sessions are not accepted on these routes.

| Route | Scope | Notes |
|---|---|---|
| `GET /supply360/attributes` | `attributes.read` | Categories and attribute keys; special-category keys only with `health.aggregate` |
| `POST /supply360/counts` | `audience.counts` | Same counts and suppression as the admin explorer. Health filters need `health.aggregate` and `purpose: study_feasibility` |
| `POST /supply360/match` | `audience.match` | Eligible members (active adult membership, terms accepted, usable address, no opt-out or bounce, under contact caps, not held for another project) as `{ref, panel, categories, country}`, with exclusion counts. Below the minimum cell, no refs. Health criteria are refused |
| `POST /supply360/reservations` | `reservations.write` | Holds refs for one project, up to 14 days. Refs held by another active reservation are refused |
| `GET`, `DELETE /supply360/reservations/{id}` | `reservations.write` | Status, or release |
| `POST /supply360/invitations/authorize` | `invitations.authorize` | Checks each reserved ref again and records an invitation for those who pass. Nothing is sent and no address is shared; MADP delivers once sending is approved |
| `POST /supply360/participation/events` | `participation.write` | click, start, partial, complete, terminate, quota_full, quality_fail, duplicate, security_reject, technical_error. Each event id counts once. Updates the invitation's status and first click. Credits no rewards |
| `POST /supply360/consent/check` | `consent.check` | Consent state and eligibility per ref, for `survey_invitation` (terms) or `email_marketing` |
| `GET /supply360/integrations/health` | `integrations.health` | Status of the client's panels, no data |

Admins with `service_clients.manage` (super admin, platform admin) create, list and revoke clients at
`/service-clients`. The secret is returned once and stored encrypted. The admin screen is Supply360 → Supply360
console.

Not built: OAuth2 client credentials (HMAC signing covers authentication), and reminders for invitations that were
not clicked, which wait until MADP sends invitations.

## 5. Consent and preference center (implemented on DEMO data, 2026-11-24)
| Route | Permission | Notes |
|---|---|---|
| `GET /consent/summary?panel=` | `consent.read` | Per panel: people per purpose and status, contactability funnel, MADP opt-outs by channel, gaps |
| `GET /consent/events?panel=&purpose=&limit=` | `consent.read` | Append-only consent history, newest first; person ids only |
| `GET /consent/preferences?panel=&limit=` | `consent.read` | Channel opt-outs and lifts recorded in MADP |
| `GET /consent/persons/{personId}` | `consent.read` | Current consent, full history (including records moved by a merge), preferences. Audited as `consent.person_viewed` |
| `POST /consent/persons/{personId}/preferences` | `consent.manage` | `{panel, channel: email|sms|push|whatsapp|all, status: opted_out|resumed, source, reason}`. 409 when it would not change anything; `resumed` only lifts a MADP opt-out |

`consent.read`: super admin, privacy officer, support, data steward. `consent.manage`: super admin, privacy officer, support.

## 6. Privacy requests (implemented on DEMO data, 2026-11-24)
| Route | Permission | Notes |
|---|---|---|
| `GET /privacy/requests?status=` | `privacy.read` | Open, overdue and awaiting-panel counts, and requests (open first, by due date) |
| `POST /privacy/requests` | `privacy.request` | `{personId, kind: access|correction|deletion|restriction, panels?, reference, jurisdiction?, dueInDays}`. 409 if an open request of that kind covers the panels |
| `GET /privacy/requests/{id}` | `privacy.read` | With its trail and erasure holds |
| `POST /privacy/requests/{id}/verify` · `/execute` · `/reject` · `/complete` | `privacy.execute` | `{note}`. Never by the person who logged it. `complete` only for a correction waiting on the panel |
| `GET /privacy/requests/{id}/export` | `privacy.execute` + `panellists.pii.read` + `health.sensitive.read` | Decrypted export for a verified access request. Audited |
| `GET /privacy/retention` · `POST /privacy/retention/{key}/purge` | `privacy.read` · `privacy.execute` | Schedule with rows due; evidence rules refuse a purge |

`privacy.read`: super admin, privacy officer, support. `privacy.request`: the same. `privacy.execute`: super admin, privacy officer.

## 7. Profile freshness (implemented on DEMO data, 2026-11-24)
`GET /profiles/freshness?panel=&staleDays=180` (`audience.counts.read`): per panel `activeMemberships`, `questionBank`, `membersWithAnswers`, `neverProfiled`, `dueForCheck`, `completeness` bands, `leastAnswered` (10), `attributes` (approved mappings only), `hiddenSensitiveQuestions` and `lastSync`. Health questions and attributes need `health.sensitive.read`.

## 8. Verification and data quality (implemented on DEMO data, 2026-11-24)
All routes are `@BrandScoped({ allowAll: true })`: the `x-madp-brand` header limits them to one panel.
- `GET /verification/summary?panel=` (`verification.read`): `checks` (key, label, why) and per panel `members`, `sourceReported` (email, phone, qualityScore bands), `checks` counts, `evidence` per claim (pending, verified, expired, rejected, revoked) and `identityReviewOpen`.
- `GET /verification/checks?panel=&check=&limit=50` (`verification.read` + `panellists.read`): person ids, masked panel ids, quality score, e-mail state, country (time zone for the time-zone checks). No personal data.
- `GET /verification/evidence?panel=&status=&personId=` (`verification.read`).
- `POST /verification/evidence` `EvidenceCreate` (`verification.review`): 404 when the person is not a member of that panel.
- `POST /verification/evidence/:id/decision` `EvidenceDecision` (`verification.review`): 403 for the admin who recorded it, 409 unless pending.
- `POST /verification/evidence/:id/revoke` `EvidenceRevoke` (`verification.review`): verified evidence only.

## 9. Reports and exports (implemented on DEMO data, 2026-11-24)
`@BrandScoped({ allowAll: true })`. Keys: `REPORT_KEYS` in `packages/contracts/src/reports.ts`.
- `GET /reports` (`reports.read`): the catalogue with `canView` and `canExport` for this admin and brand.
- `GET /reports/:key?panel=&from=&to=` (`reports.read` + the report's own permission): `ReportResult` with `columns`, `rows`, `period`, `notes`, `dataMode`. 404 for an unknown key; 400 when `from` is after `to`.
- `GET /reports/:key/export?format=csv|xlsx&panel=&from=&to=` (`reports.read`, `export.read`, the report's permission): a file named `madp-<key>-<brand>[-DEMO]-<date>.<ext>`, audited as `report.exported`.

## 10. AI insights (implemented on DEMO data, 2026-11-24)
`@BrandScoped({ allowAll: true })`. Rule keys: `INSIGHT_RULES` in `packages/contracts/src/insights.ts`.
- `GET /insights?panel=&status=` (`insights.read`): `items`, `rules` (each rule's threshold in words) and `lastRefreshedAt`.
- `POST /insights/refresh?panel=` (`insights.review`): `{ raised, updated, resolved }`, audited as `insights.refreshed`.
- `POST /insights/:id/decision` `InsightDecision` (`insights.review`): accepted or dismissed with a note; 409 unless open.

