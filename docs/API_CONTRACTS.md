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
| `POST /audience/counts` `CountsRequest` | `audience.counts.read` (+ `health.sensitive.read` for special-category attributes) | `CountsResponse`: unique people, memberships, category memberships, per panel/category/country cells with suppression and freshness; `attributes` filters resolve through approved mappings and are reported in `attributeFilters` |
| `GET /audience/attributes` | `questions.read` | Canonical attribute definitions |
| `GET /panellists?panel&category&country&search&after&limit` | `panellists.read` | Keyset-paged list with masked identifiers; `search` is an exact member id or an exact e-mail (keyed hash) |
| `GET /panellists/:id` | `panellists.read` | 360 view. PII needs `panellists.pii.read`; MHO special-category answers need `health.sensitive.read`. Audited |
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
| `GET /audit?before&limit` | `audit.read` | Audit events, newest first |

## 2. Source panel endpoints MADP calls (verified in source, not live)
Defined once in `packages/connectors/src/http-connector.ts` (`ENDPOINTS`). The base URL host must equal the panel's
tenant host, because each panel resolves its tenant from the `Host` header.

| Purpose | T2O | MFR | MHO |
|---|---|---|---|
| Questionnaires | `GET /api/v1/profile` | same | same |
| Questions | `GET /api/v1/question` | same | same |
| Options | `GET /api/v1/option/:question` | same | same |
| Respondents | `POST /api/v1/user` `{}` | `POST /api/v1/user` `{}` | `POST /api/v1/user` `{}` (unverified on the T2O image) |
| Answers | `GET /api/v1/user/:id/profile` | `POST /api/v1/user/:id/profile-data` `{questions}` | `POST /api/v1/user/:id/profile-data` `{questions}` |

## 3. Proposed non-breaking additions to the panels (needs owner approval; nothing changed)
Each addition is new, read-only and behind a scoped service credential, so existing clients are unaffected.

```
POST /api/v1/integration/token            client_credentials → 15-minute JWT, scopes: profile:read users:read answers:read
GET  /api/v1/integration/members          ?updatedSince=ISO&cursor=&limit≤500 → {items:[{id, category, mail, verified, isActive, isDeleted, createdAt, updatedAt}], nextCursor}
GET  /api/v1/integration/answers          ?updatedSince=ISO&cursor=&limit≤1000 → {items:[{user, question, answer:string[], updatedAt}], nextCursor}
GET  /api/v1/integration/consents         ?updatedSince=ISO&cursor= → {items:[{user, purpose, channel, status, capturedAt, evidence}], nextCursor}
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
