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

## 4. Supply360 contract (spec §12): planned for M6, not implemented
| Proposed path | Notes |
|---|---|
| `GET /audience/attributes` | Implemented for admins; Supply360 access needs a service client |
| `POST /audience/counts` | Implemented for admins; same suppression rules will apply to Supply360 |
| `POST /audience/match` | Returns eligible counts and an opaque cohort id, never PII or health answers |
| `POST /audience/reservations` | Holds a cohort for a project batch, with expiry and idempotency key |
| `POST /invitations/authorize` | Consent, fatigue and suppression check for an invitation batch |
| `POST /participation/events` | click, start, partial, complete, terminate, quota-full, quality-fail, duplicate, security-reject, technical-error; idempotent |
| `POST /consent/check` | Per-person, per-purpose, per-channel consent answer |
| `GET /integrations/health` | Implemented for admins |
| `GET /communications/timeline/{personId}` | MADP privileged roles only, never Supply360 by default |

Service auth will use OAuth2 client credentials plus HMAC request signing, with a per-client scope list and rate limit.
