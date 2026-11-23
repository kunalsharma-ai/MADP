# Integration gap analysis: T2O, MFR, MHO → MADP

Status as of 2026-11-23 (Milestone 1). Evidence comes from the read-only audits in
`REPOSITORY_AUDIT_T2O.md`, `REPOSITORY_AUDIT_MFR.md` and `REPOSITORY_AUDIT_MHO.md`. Nothing here was tested against a
live panel. **Verified** means seen in source code at the audited commit. **Proposed** means a change MADP needs and
that the panel owner must approve.

## 1. Capability matrix (verified from source)

| Capability (spec §5) | T2O | MFR | MHO (repo) | MHO (production) |
|---|---|---|---|---|
| Questionnaire / question / option read | ✅ unauthenticated `GET` | ✅ unauthenticated `GET` | ✅ unauthenticated `GET` | ❓ runs T2O image 1.0.1 |
| Respondent list | ⚠️ `POST /api/v1/user`, any member, raw filter | ✅ `POST /api/v1/user`, admin, `safeFilter` | ✅ `GET/POST /api/v1/user`, `isAdmin` (buggy) | ❓ |
| Answers per respondent | ⚠️ `GET /user/:id/profile`, any member | ✅ `POST /user/:id/profile-data` | ✅ `POST /user/:id/profile-data` | ❓ |
| Pagination | ❌ | ❌ | ❌ | ❓ |
| Updated-since / cursor | ❌ | ❌ | ❌ | ❓ |
| Webhooks / outbound events | ❌ | ❌ | ❌ (in-process EventEmitter only) | ❓ |
| Scoped service credential | ⚠️ `/user/apps` (insecure, T2O-SEC-01) | ❌ member JWT, 7 days | ❌ | ❓ |
| Consent record | ⚠️ `User.consent` + answers | ⚠️ `MemberPreference`, answers `terms-consent`/`news-letter` | ⚠️ `User.consent`, guardian consent | ❓ |
| Deletion request / event | ❌ | ⚠️ `DataRequest`, manual, no event | ❌ | ❓ |
| Questionnaire write API | ⚠️ exists, unauthenticated | ⚠️ exists, unauthenticated | ⚠️ exists, unauthenticated | ❓ |
| Reward ledger read | ⚠️ member-scoped only | ⚠️ member-scoped, derived ledger | ⚠️ member-scoped | ❓ |

The same matrix is encoded in `packages/connectors/src/capabilities.ts` (`AUDITED_CAPABILITIES`) and shown on the
Connectors page, so the UI cannot claim more than the audit found.

## 2. Gaps and what MADP does about each

| ID | Gap | Impact | MADP workaround in M1 (implemented) | Proposed panel change (needs approval) |
|---|---|---|---|---|
| G-01 | No scoped, revocable integration credential on any panel | Live import would need a person's admin JWT or the insecure T2O app login | Connector refuses LIVE unless a token is configured via env and the panel is listed in `LIVE_SOURCE_APPROVED_PANELS` | Add a read-only service client per panel: hashed secret, scopes `profile:read users:read answers:read`, rotation, audit log |
| G-02 | Respondent list is unpaginated | Full list per call; memory and timeouts at scale | Fetched once per run, paged locally at 200, checkpointed | `GET /api/v1/integration/members?cursor=&limit=&updatedSince=` |
| G-03 | No updated-since for answers | Every sync re-reads every member | Content-hash comparison, so unchanged answers write nothing | `GET /api/v1/integration/answers?updatedSince=&cursor=` returning `{user, question, answer[], updatedAt}` |
| G-04 | Tenant is `origin = Host` header | Calling the API through a different host returns another tenant's data or nothing | Connector refuses to start unless the base URL host equals the configured `tenantHost` | Confirm the production origin host for each panel |
| G-05 | No deletion or consent-withdrawal events | Deletions might never reach MADP (spec §5 forbids losing them) | `webhook_inbox` table and outbox are in place; deletion propagation **not implemented** | Signed webhooks `member.deleted`, `consent.changed`, `answer.updated` (HMAC-SHA256, timestamp, idempotency key) |
| G-06 | ✅ Resolved 2026-11-23: MFR and MHO production run the T2O backend | The MFR/MHO repo API code (including MFR's access lock-down) is not deployed; T2O's findings apply to all tenants | All three connectors use the T2O backend endpoint map and capability findings | Either deploy the panel repos' own APIs or port MFR's `utils/access.js` lock-down into the T2O backend |
| G-07 | MFR question definitions are not in the repo | MFR mapping uses placeholder definitions | Synthetic fixture labelled `[placeholder]`, `verified:false` | Share a definitions-only export (Profile, Question, Option; no members) |
| G-08 | MHO CareGiver export carries category `healthcare professional` | Caregiver questions could be mapped to HCP | Category for MHO questionnaires is a pending suggestion, never auto-applied | Confirm which is correct |
| G-09 | Question writes are unauthenticated in all three repos | Anyone could change questionnaires; MADP's question registry could be poisoned | MADP versions every question by content hash and keeps history | Add admin auth to question/option write routes |
| G-10 | No questionnaire-write integration contract | Spec §6 deploy-to-panel cannot be done safely | Not implemented; builder is M4+ | Authenticated `POST /api/v1/integration/questions` with approval id |
| G-11 | Consent split across user fields, answers and preference collections | Consent eligibility may be wrong | Consent is modelled per panel and purpose in `consent_record`; not yet populated from sources | Expose a per-member consent summary with timestamps and evidence |

## 3. Evidence received 2026-11-23
Kunal shared two reference files (kept in the project files, not in this public repo):
- **OpenAPI 3.0 document, "Turn2Opinion Backend API"** (marked "observed", 87 paths). It describes **one backend
  serving all three tenants** by `Host`, and lists production servers `https://www.turn2opinion.com`,
  `https://www.myfrequentrewards.com` and `https://www.myhealthopinions.com`. Every panel route MADP calls
  (`ENDPOINTS` in `http-connector.ts`) is present in it. It adds evidence for G-06 (MHO runs the T2O backend) and
  raises a new question: whether **MFR production** also runs the T2O backend rather than the `mfr-api` code in the
  MFR repo. The two differ in answer routes and access checks.
- **T2O backend Mongoose models** (`model/*.js`, 24 files, schema code only, no member data). 22 files match the
  T2O repo exactly. `User.js` is an older version (no teen-consent fields) and `Testimonials.js` differs, so this is
  probably a deployed or branch build of the T2O backend. It is not the MFR question export (G-07 stays open).

## 4. Blocked items (need Kunal)
1. ✅ Live read-only access approved by Kunal on 2026-11-23 for all three panels (dry run first). Still needed: an
   integration credential per panel in the cloud environment (`T2O_API_TOKEN`, `MFR_API_TOKEN`, `MHO_API_TOKEN`),
   never in chat or git.
2. Confirmation that the tenant `origin` values are exactly `www.turn2opinion.com`, `www.myfrequentrewards.com` and
   `www.myhealthopinions.com` (with `www.`). The OpenAPI document's prose names the hosts without `www.`.
3. The MFR definitions export.
4. ✅ Answered: MFR and MHO production run the T2O backend.
5. Panel-owner decision on the security fixes in `SECURITY_PRIVACY.md` §5.
