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
| Scoped service credential | ⚠️ app login exists but is not suitable | ❌ member JWT, 7 days | ❌ | ❓ |
| Consent record | ⚠️ `User.consent` + answers | ⚠️ `MemberPreference`, answers `terms-consent`/`news-letter` | ⚠️ `User.consent`, guardian consent | ❓ |
| Deletion request / event | ❌ | ⚠️ `DataRequest`, manual, no event | ❌ | ❓ |
| Questionnaire write API | ⚠️ exists, unauthenticated | ⚠️ exists, unauthenticated | ⚠️ exists, unauthenticated | ❓ |
| Reward ledger read | ⚠️ member-scoped only | ⚠️ member-scoped, derived ledger | ⚠️ member-scoped | ❓ |

The same matrix is encoded in `packages/connectors/src/capabilities.ts` (`AUDITED_CAPABILITIES`) and shown on the
Connectors page, so the UI cannot claim more than the audit found.

## 2. Gaps and what MADP does about each

| ID | Gap | Impact | MADP workaround in M1 (implemented) | Proposed panel change (needs approval) |
|---|---|---|---|---|
| G-01 | No scoped, revocable integration credential on any panel | Live import would need a person's admin JWT or the unsuitable T2O app login | Connector refuses LIVE unless a token is configured via env and the panel is listed in `LIVE_SOURCE_APPROVED_PANELS` | Add a read-only service client per panel: hashed secret, scopes `profile:read users:read answers:read`, rotation, audit log |
| G-02 | Respondent list is unpaginated | Full list per call; memory and timeouts at scale | Fetched once per run, paged locally at 200, checkpointed | `GET /api/v1/integration/members?cursor=&limit=&updatedSince=` |
| G-03 | No updated-since for answers | Every sync re-reads every member | Content-hash comparison, so unchanged answers write nothing | `GET /api/v1/integration/answers?updatedSince=&cursor=` returning `{user, question, answer[], updatedAt}` |
| G-04 | Tenant is `origin = Host` header | Calling the API through a different host returns another tenant's data or nothing | Connector refuses to start unless the base URL host equals the configured `tenantHost` | Confirm the production origin host for each panel |
| G-05 | No deletion or consent-withdrawal events | Deletions might never reach MADP (spec §5 forbids losing them) | `webhook_inbox` table and outbox are in place; deletion propagation **not implemented** | Signed webhooks `member.deleted`, `consent.changed`, `answer.updated` (HMAC-SHA256, timestamp, idempotency key) |
| G-06 | MHO production runs `turn2opinion/backend:1.0.1` | Routes and auth checks of the live MHO API are unknown | MHO respondent/answer capabilities marked `unknown` | Confirm the image, or deploy `Project/backend` |
| G-07 | MFR question definitions are not in the repo | MFR mapping uses placeholder definitions | Synthetic fixture labelled `[placeholder]`, `verified:false` | Share a definitions-only export (Profile, Question, Option; no members) |
| G-08 | MHO CareGiver export carries category `healthcare professional` | Caregiver questions could be mapped to HCP | Category for MHO questionnaires is a pending suggestion, never auto-applied | Confirm which is correct |
| G-09 | Question writes are unauthenticated in all three repos | Anyone could change questionnaires; MADP's question registry could be poisoned | MADP versions every question by content hash and keeps history | Add admin auth to question/option write routes |
| G-10 | No questionnaire-write integration contract | Spec §6 deploy-to-panel cannot be done safely | Not implemented; builder is M4+ | Authenticated `POST /api/v1/integration/questions` with approval id |
| G-11 | Consent split across user fields, answers and preference collections | Consent eligibility may be wrong | Consent is modelled per panel and purpose in `consent_record`; not yet populated from sources | Expose a per-member consent summary with timestamps and evidence |

## 3. Blocked items (need Kunal)
1. Approval for live, read-only access to each panel, and an integration credential delivered via secure configuration (never chat or git).
2. The production origin host for T2O, MFR and MHO.
3. The MFR definitions export.
4. Confirmation of which backend image MHO production runs.
5. Panel-owner decision on the security fixes in `SECURITY_PRIVACY.md` §5.
