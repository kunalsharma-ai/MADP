# Repository audit: Turn2Opinion (T2O)

- **Repository:** github.com/kunalsharma-ai/turn2opinion (public), audited read-only at commit `90b48a2` on 2026-11-23.
- **Method:** source reading only. No production endpoint was called and no data was read. Every finding is "verified in code"; nothing here is verified against the running production system yet.
- **Legend:** ✅ verified in code · ⚠️ partial / caveat · ❌ absent · ❓ unknown until a live, authorised check.

## 1. Runtime and stack

| Area | Finding |
|---|---|
| Backend | `Project/backend` — Node.js ESM, Express 4.19, Mongoose 8.5, JWT (`jsonwebtoken`), bcryptjs, `express-web-tools`. Entry `app/server.js`, `npm start`. No lockfile committed for the backend. |
| Database | MongoDB (`process.env.mongodb`, default `mongodb://db/mfr`). One database per deployment; tenant column `origin` on every document. |
| Multi-tenancy | ✅ `utils/setOrigin.js`: `req.origin = req.headers.host`. Every model gets `origin` (required) via `utils/mongooseModel.js`; `CrudController.commonFilters` adds `{origin, isActive:true, isDeleted:false}`. The CORS allow-list and `docs/openapi.yaml` show the same backend serving T2O, MFR and MHO hosts. |
| Frontends | `Project/frontend` (Next.js 15.5, React 19.1, member + admin pages), `Project/frontend-1` (Vite 7, React 19.2 public site + member area). |
| Mail | `Project/mailer` Liquid templates (register, newuser, birthday, survey, project, support, design-v1). |
| Docs | `docs/openapi.yaml` (87 "observed" paths, OpenAPI 3.0.3) — useful, but generated from observation, not the contract source of truth. |
| Tests | `backend/test/supportAccess.test.js`, `supportRoutes.test.js` (node:test). No tests for questions, answers, users or rewards. |

## 2. Identity and registration
- ✅ `User` model (`app/model/User.js`): `_id`, optional `respondentID`, `category` (default `b2c`; also `b2b`, `minor`), `name{salutation,first,middle,last}`, `gender` enum Male/Female/Other (required), `dob` (required, age 13–120), `mail` (lower-cased, MX-validated), `phone` (E.164), `timezone` (required), `address[]{tag,house,street,city,state,country,zipcode,gps}`, `isVerified{email,phone,video,inPersonVisit}`, `qualityScore` (default 100), `notification[]`, `consent{canShareVideo,canShareGPS,canAcceptPushNotification}`, `terms[]`, `role` (respondent/administrator/root/admin, `select:false`), `paymentMethod`, `parent{...}` teen guardian record with `consentStatus`, decision, onboarding, consent record, reminders.
- ✅ Unique index `{mail, origin}` — one account per e-mail **per panel**, so the same person can legitimately hold T2O, MFR and MHO accounts.
- ✅ Country lives in `address[0].country` (lower-cased); virtual `country` upper-cases it.
- ⚠️ Teen (13–17) registration with guardian consent workflow (`/parent-decision`, `/parent-onboarding`, `/parent-consent`, `/parent-link-renew`, `/teen-reminders` with `x-cron-key`).

## 3. Questionnaires, questions, options, answers
- ✅ **DB-driven**, not code-defined. `Profile` = questionnaire: `{name, slug, category, pages: [[pageTitle, ...questionNames]], points}`; unique `(slug, category, origin)`.
- ✅ `Question`: `name` (the stable source question id), `label`, free-text `type` (no enum enforced), `parent` (cascade driver), `category[]`, `isRequired`, `hasOthers`, `hasNone`, `hasSkip`, `maxSelections` (string), `icon`, `size`. Unique `(name, category, origin)`.
- ✅ `Option`: `{question, label, value, parentValue[], isExclusive, describeLabel}`; unique `(question, value, origin, label)`. Cascading lists keyed by the parent question's answer (`parentValue`).
- ✅ `Answer`: `{user (string id), question (name), answer: string[] (select:false)}`; unique `(user, question, origin)`; saved with `bulkWrite` upserts (`controller/Answer.js#save`). **No per-answer history**: an update overwrites. `updatedAt` exists (timestamps) but is not exposed for incremental reads.
- ⚠️ No question versioning: editing a question's label/options in place changes the meaning of existing answers with no trace. MADP versions on its side (content hash per import).
- ✅ Multilingual: question/option text is stored in one language; translation happens in the frontends (`i18n/`). ❓ whether non-English answers exist.
- ✅ A full snapshot of the question bank (820+ questions, all options, 50 profiles) is committed for demo mode at `Project/frontend-1/src/member/data/demo-bank/bank.json` (README says it matches the admin export). MADP's T2O sample fixture is extracted from it (definitions only, no personal data).
- ✅ Surveys: `Survey` (`slug, name, category, source, points, filters, link, loi`), `Response` (`user, survey{name,slug}, status` invited/complete/terminate/dropout, `points, loi, telemetry`), `ProjectLaunch`, `Batch`, `Invites`. External surveys via `/api/v1/integration/*`.

## 4. Consent, verification, preferences, deletion
- ⚠️ Consent is split across `User.consent{...}`, `User.terms[]`, `User.notification[]` channel subscriptions and teen `parent.consentStatus`. No purpose-specific consent log with timestamps/versions for adult marketing consent.
- ✅ Verification states per channel in `User.isVerified`.
- ❌ Account deletion: `DELETE /api/v1/user/:id` hard-deletes (`findByIdAndDelete`); answers and responses are left behind; no tombstone or event, so downstream systems cannot learn about deletions.

## 5. Rewards
- ⚠️ `Rewards` model via `express-web-tools` `MongooseModel` (`user, category, points, remarks, status` default "credited", audit-enforced). Survey points also on `Response.points`. `GET /api/v1/me/points|rewards|statistics` are member-scoped. No append-only ledger with reversal states.

## 6. API surface relevant to MADP

| Need | Endpoint | Auth | Notes |
|---|---|---|---|
| Questionnaires | `GET /api/v1/profile` | none | all profiles for the tenant |
| Questions | `GET /api/v1/question` | none | adds `count` of options |
| Options | `GET /api/v1/option/:question` | none | full list (city lists are large) |
| Respondents | `POST /api/v1/user` | any signed-in user | body is passed straight to Mongo as a filter; returns **all** matching users, no pagination |
| Answers | `GET /api/v1/user/:id/profile` | any signed-in user | user fields merged with `{question: answer}` |
| Service auth | `POST /api/v1/user/apps` | none | see T2O-SEC-01 |
| Webhooks | — | — | ❌ none |

## 7. Security findings (report to the T2O owner; MADP does not depend on them)
Severity is the auditor's estimate from code reading. None was exploited or tested against production.

- **T2O-SEC-01 (critical):** `POST /api/v1/user/apps` → `appLoginUser(req.body)` finds a `role:"root"` app user by whatever fields the caller sends and returns a **365-day** JWT. No secret is checked. `GET /api/v1/user/apps` (no auth) lists app users. Anyone who can reach the API could obtain a root token for that tenant.
- **T2O-SEC-02 (critical):** `GET /api/v1/user/birthday/today` has no authentication and returns names and e-mail addresses of members whose birthday is today.
- **T2O-SEC-03 (high):** `POST /api/v1/user`, `GET /api/v1/user/:id/profile` and `GET /api/v1/user/:id/survey` only require *a* signed-in user, not an admin. Any member can list other members and read their answers. The `POST /api/v1/user` body is used unfiltered as a Mongo query (operator injection).
- **T2O-SEC-04 (high):** `PUT/DELETE /api/v1/question/:id`, `PUT /api/v1/question`, option create/update/delete have no auth check.
- **T2O-SEC-05 (medium):** `Profile.status()` aggregation matches `isActive/isDeleted` but not `origin`, so profile completion may mix tenants that share a database.
- **T2O-SEC-06 (medium):** `sync.sh` restores a production `mongodump` into a local environment — personal data leaves production for development.
- MFR has already locked several of these down (`utils/access.js`, Nov 2026); the same changes would close SEC-03.

## 8. What MADP needs from T2O (see INTEGRATION_GAP_ANALYSIS.md)
A scoped, revocable integration credential; a paginated, updated-since member endpoint; an updated-since answers endpoint; deletion/consent-withdrawal events; and confirmation of the exact `origin` host value used in production.
