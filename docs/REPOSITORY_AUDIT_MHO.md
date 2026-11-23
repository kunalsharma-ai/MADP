# Repository audit: MyHealthOpinions (MHO)

- **Repository:** github.com/kunalsharma-ai/MHO (private), audited read-only at commit `f0c2ac5` on 2026-11-23.
- **Method:** source reading only; no production access. Legend as in the T2O audit.
- **Sensitivity:** MHO recruits healthcare professionals, patients (including `minor patient`) and caregivers. Answers about conditions, treatment, diet, smoking, alcohol, sleep etc. are **health data** (special category). MADP treats every MHO answer as special-category unless the question is on an explicit demographic allow-list (`apps/api/src/ingestion/canonical.ts#sensitivityFor`).


> **Production note (2026-11-23):** the owner confirmed that MFR and MHO production run the **T2O backend**
> (separate tenants by `Host`), not the API code in their own repositories. The connectors and capability matrix
> follow the T2O backend for all three panels, and the T2O security findings apply to every tenant. This audit of
> the repository code stays as a record of what is *not* deployed.

## 1. Runtime and stack — the most important finding
| Area | Finding |
|---|---|
| Deployed backend | ⚠️ `docker-compose.yml` runs **`registry.sampledge.com/turn2opinion/backend:1.0.1`** (the T2O backend image) and mounts only `Project/backend/app/controller/Profile.js` and `app/new-module` from this repo. So the code that serves MHO in production is mostly *T2O backend v1.0.1*, not `Project/backend` here. |
| Repo backend | `Project/backend` (package name `samp-api-auth`) imports `../../utils/*`, which does not exist at that path (utils live in `Project/utils`); it is not runnable stand-alone as committed. |
| Consequence | ❓ Which routes, auth checks and fields MHO production actually exposes is **unknown until verified live**. The connector capability matrix marks respondent/answer reads as `unknown`. |
| Frontends | `Project/web` (Next.js 15.5), `Project/frontend-1` (Vite 7, React 19.2), `Project/sections/{hcp,patient,caregiver}` — stand-alone React 19 "My Profile" sections with 12 languages, RTL, Playwright tests. |
| Services | email (SMTP), email-scheduler, gateway (nginx), storage, an experimental `llama-agent`. README describes RabbitMQ/ELK/payment services that are not in the compose file. |
| Events | `Project/utils/EventStream.js` is an in-process `EventEmitter` (events `admin-list-users`, `admin-user-profile-check`, …). No outbound delivery, so not usable as webhooks. |
| API docs | `api-documentation/api/v1/**/swagger.json` — per-route Swagger fragments (64 files). |

## 2. Identity
- ✅ `User` model is the older common shape (CRLF line endings): `name.last` required, `role` enum includes `admin`, guardian relation `father|mother`. Categories observed: `healthcare professional`, `patient`, `care giver`, `minor patient`.

## 3. Questionnaires and answers
- ✅ Same `Profile` / `Question` / `Option` / `Answer` models (DB-driven).
- ✅ **Mongo exports committed** in `Project/sections/hcp/data-source/`: `myhealthopinions.{HealthcareProfessional,Patient,CareGiver}.{Profile,Question}.json` and `myhealthopinions.Option.json` (165,613 options; 129k are city names). Definitions only — no respondents or answers. MADP's MHO sample fixture is extracted from these.
  - HCP: 10 questionnaires, 118 questions · Patient: 24 / 288 · Caregiver: 22 / 309.
  - ⚠️ Data-quality: questionnaires in the **CareGiver** export carry `category: "healthcare professional"`. Either the export is mislabelled or caregiver profiles are stored under the HCP category. Must be confirmed before category mapping is approved.
  - ⚠️ Exports have no `type`, `origin` or option `isExclusive`, so question types must come from the live API.
- ✅ `new-module/Survey.js` adds eligibility filtering: a survey's `filters` `{question: allowedValues}` are matched against the member's answers.

## 4. Consent, verification, deletion
- ⚠️ `User.consent`, `User.terms[]`, guardian consent for minors. No purpose-specific health-data consent record (explicit consent for processing health data is the key legal basis question; needs counsel).
- ❌ No deletion-request model or deletion event.

## 5. Rewards
- ✅ `Rewards` model with `activity`, `reward`, `reference{id,source}`, `status` Pending/Approved/Rejected and `balance`. HCP sections award "70 Reward Points + 5 Quality Score" per completed profile (README). Separate from T2O/MFR.

## 6. API surface (repo version; deployed version unverified)
| Need | Endpoint | Auth in repo |
|---|---|---|
| Questionnaires / questions / options | `GET /api/v1/profile`, `GET /api/v1/question`, `GET /api/v1/option/:q` | none |
| Respondents | `GET/POST /api/v1/user` | `isAdmin` |
| Answers | `POST /api/v1/user/:user/profile-data` `{questions}` | `isAdmin` |
| Service accounts / webhooks | — | ❌ |

## 7. Security findings
- **MHO-SEC-01 (high):** `utils/isAdmin.js` throws `new HttpError(...)` inside a callback, but `HttpError` is not imported; a non-admin request would crash the handler instead of returning 403. Combined with the image mismatch above, the real behaviour must be tested.
- **MHO-SEC-02 (high):** question/option write endpoints have no auth check (as T2O-SEC-04).
- **MHO-SEC-03 (medium):** production runs code that is not in this repository (T2O image), so reviews of this repo do not cover what serves health data.
- **MHO-SEC-04 (medium):** `logs/` and `app/logs/admin-logs` are committed paths; confirm no personal data is ever written there.
