# Progress

## Mailer library (2026-11-24)

Kunal's mailer packs for all three panels are in MADP, read-only.

### Completed and tested
- 98 Liquid templates in 6 packs: T2O v1 (22), MFR v6 lifecycle (4) and system (18), and MHO healthcare
  professional, caregiver and patient (18 each). `ops/mailers/import-mailers.mjs` re-imports them when a pack changes.
  The data is in `apps/api/mailers`, and the images the templates use are in `apps/admin/public/mailers` for previews.
- Every merge field is mapped to where its value comes from (`MERGE_FIELDS` in `packages/contracts/src/mailers.ts`).
  The test fails if a pack adds a field nobody has mapped.
- Communications, Mailer library: a catalogue by pack, showing who sends each one. System emails are sent by the panel
  at the event. New survey, birthday and the two profile reminders can be used as MADP campaigns. Each template page
  shows the designers' sample render in a sandboxed frame, the subjects, trigger, merge fields, plain text and Liquid.
- `test/mailers.test.ts` (4 tests) covers all three panels, field mapping, previews and brand scoping.

### Not yet
- Previews use the designers' sample data. MADP campaigns still use the studio's own templates; turning a library
  template into a studio template is the next step.
- The footer comes from Brands & settings (#27) once that merges.
- Nothing is sent. Sending needs a provider and Kunal's approval.
## Production readiness (Milestone 6, 2026-11-24)

Local and DEMO only. Nothing is deployed, and deploying needs Kunal's go-ahead.

### Completed and tested
- Route security inventory (`apps/api/test/security.test.ts`, 9 tests). Every route is checked from the controllers' own
  metadata. Each is either public by design (health, OpenAPI, login, and the Supply360 and webhook routes, which check
  their own signatures) or needs a session and a permission. No route answers without credentials. Tampered, foreign,
  unsigned and expired tokens are refused. Security headers are set, CORS allows only the admin origin, malformed input
  gets 400 or 413, and sign-in is throttled.
- OpenAPI now documents every route for audience, geography, consent, privacy, profiles, verification, reports,
  insights and Supply360 (the test checks this).
- Rate limit per client address is configurable (`RATE_LIMIT_PER_MINUTE`, default 300).
- Backup and restore drill (`ops/backup/restore-drill.sh`). It ran on the preview database and matched 50 tables and 4
  collections exactly in about 11 seconds.
- Load test (`ops/load/load-test.mjs`) at 300 and 5,000 demo people across all three panels, with no errors. Results
  are in `docs/PERFORMANCE.md`.
- Runbooks (`docs/RUNBOOKS.md`): alerts, deploy (not executed), backup and restore, key rotation, panel sync failure,
  privacy deadlines, and security incidents.

### Not yet
- The verification summary takes about 0.4 s at 5,000 people. The consent summary was fixed: p50 went from 0.9 s to
  0.13 s under load.
- No production environment, monitoring or alerting is set up. That waits for Kunal's deploy decision.

## Super admin console, step 2: members, question bank and profiles (2026-11-24)

Spec modules 1 to 4 for MFR. The panel side is in kunalsharma-ai/MFR#44 and #45 (merged, not deployed).

### Completed and tested
- Write path: the shared panel backend has a new `/api/admin/v1`. MADP signs every call with HMAC-SHA256 over the
  time, method, path and query, brand hostname, admin id and body hash. The brand is the first origin in Brands &
  settings. Without `PANEL_ADMIN_API_SECRET` and the brand's `*_ADMIN_API_BASE_URL`, the screens say the brand is not
  connected. The routes are listed in `packages/connectors/src/http-connector.ts` (`PANEL_ADMIN_ROUTES`).
- Members: search (masked, 50 a page, every filter the spec lists) and a member page with overview, ledger points,
  counts and segment changes.
  - Suspend, ban, reactivate, archive and restore, each with a reason. Suspended and banned members can't sign in.
  - Segment change between adult segments, logged, with answers kept.
  - Verification and allowed-field edits.
  - Unmask needs `pii.view` and a reason. The audit entry names the fields, never the values.
  - Six-month check: a dry run, then archive with a reason. Bulk restore.
  - Teens are hidden from roles without `teen.read`, in the results and in the totals.
- Question bank:
  - Export in today's Profile / Question / Option shape.
  - Import is a dry run first and shows adds, changes, unchanged rows, duplicates, per-segment counts, broken
    references and teen refusals. Writing needs `qb.publish` and a clean file.
  - Show-when rules checker.
  - Question and option editor. Options that are removed are retired, not deleted, and can have a country list.
  - Teen guardrails (tobacco, nicotine, alcohol, health, cosmetic, vehicle) are refused on the server.
- Profiles: order, on/off, points (the member API now pays the profile's own points, default 50), minutes, and a
  completion report with started, finished and the drop-off question.
- Every write is audited with old and new values and the reason. Reads of members are audited.
- Tests: MFR `npm run test:admin` (16 tests). MADP `test/panel-admin.test.ts` (8 tests) runs against a stand-in panel
  that checks the signature. Full MADP integration run: 110 passed.
- Previews from a local MFR backend with DEMO data: `/mnt/project-files/madp/preview-console/step2-members-question-bank/`.

### Not yet
- Question versions (draft, review, published) and translations.
- Excel import and export.
- Merge duplicates, reset password, resend welcome e-mail, log in as member.
- T2O and MHO: the same backend serves them (step 6). Leak tests per brand come before they are switched on.
- The 730 / 241 / 33 count check needs the real Profiles.json, Question.json and Option.json exports. They are not in
  the project files. The teen bank in the MFR repo (237 questions in profiles, 241 keys) imports and round-trips clean.
- Deploy: the shared secret goes into the panel backend (`MADP_ADMIN_API_SECRETS`, `MADP_ADMIN_API_ORIGINS`) and into
  MADP. This needs Kunal's go-ahead.

## Super admin console, step 1: Foundation (2026-11-24)

Kunal's super admin spec (24 Nov 2026) and the MADP master prompt are one plan; the console is built here. This step
covers the spec's Foundation. Everything runs on DEMO data; no panel was contacted.

### Completed and tested
- Roles are data: `admin_role` rows hold a name and permission strings, so new roles are made in the console without
  code. The spec's roles (Super Admin, Brand Admin, Panel Manager, Question Bank Editor, Rewards and Finance, Support
  Agent, Teen Safeguarding, Read Only Analyst) and the earlier MADP roles are seeded by migration 0011.
- Roles are granted per brand (`admin_role_grant`). Cross-brand screens need the permission on every brand, so an MFR
  Brand Admin sees no T2O or MHO rows there. Brand screens take the brand from the switcher (`x-madp-brand`), never
  from the hostname, and the server refuses brands that were not granted. You can only grant what you hold, and the
  last Super Admin on every brand cannot be removed.
- Two-factor is required for every admin (it can no longer be turned off in production). Server-side sessions end
  after 30 idle minutes (`ADMIN_IDLE_MINUTES`) and on sign-out.
- The audit log is hash-chained. Each entry stores the previous entry's hash and a SHA-256 over all its own columns,
  computed in the database on insert. `GET /audit/verify` recomputes the chain, and a changed or deleted entry breaks
  it. Entries now hold brand, actor role, old and new values (personal data masked), reason and request id.
  Filters and CSV export (`GET /audit/export`, logged).
- Brand settings per brand: origin hostnames, languages, currency, points value (1,000 = 1 USD), minimum redemption
  (15,000), four-eyes amount (50,000 points), six-month re-check and archive months. The money values are Super Admin
  only and every change needs a reason.
- Screens: brand switcher in the header, Admins & roles, Brands & settings, and Security audit (filters, chain check,
  CSV export).
- Panel backend: the six member-route holes from the spec are closed in kunalsharma-ai/MFR#42.

### Test results (2026-11-24)
| Suite | Result |
|---|---|
| `pnpm build`, `pnpm typecheck` | pass |
| `pnpm test` (unit) | all pass, including `auth/access.test.ts` (4) and `audit/mask.test.ts` (2) |
| `pnpm test:integration` | api 102 pass, including `test/foundation.test.ts` (7) |

### Next (spec build order step 2)
MFR members and the question bank (modules 1 to 4), through a new `/api/admin/v1` in the shared panel backend that only
MADP can call.

## Turn2Opinion first (2026-11-23)

Kunal asked to start with Turn2Opinion, using the T2O Member Dashboard demo preview as reference. Everything here
runs on DEMO data; no panel was contacted.

### Completed and tested
- Full T2O question bank in the DEMO fixture: all 50 sections (37 consumer, 13 teen), 848 questions, 16,847 options (a blank slot in two sections is skipped),
  extracted from the T2O repo. Option values that were `[label, value]` pairs are no longer flattened into one string.
- DEMO members answer like real ones: the basic section plus a few others that match their member type.
- Member types: consumer (`b2c`), professional (`b2b`) and teen (`minor`, flagged as a minor) map to MADP categories
  through the existing review proposals. DEMO now includes T2O teen members with 13-17 birth dates.
- Consent sync: guardian consent for teens (same rules as the member area's registration status), terms accepted, and
  push, video and location opt-ins become `consent_record` rows, one per person, panel and purpose, refreshed on each
  import. Guardian contact details and IPs are never copied. Shown on the panellist 360 page.
- Answer ingestion writes in bulk per page (one read and two bulk writes instead of one round trip per answer).

### Test results (2026-11-23)
| Suite | Result |
|---|---|
| `pnpm build`, `pnpm typecheck` | pass |
| `pnpm test` | contracts 3, config 4, testing 3, connectors 30, api 4 — all pass |
| `pnpm test:integration` | api 30 — all pass; the opt-in local T2O test (3) passed against the running copy |

### T2O end to end on a local copy
MADP imported a consumer, a business professional and two teens from a running copy of the real T2O backend
(test accounts made through T2O's own sign-up and guardian flows). The import was reconciled and the re-import was
idempotent. Details are in `docs/T2O_LOCAL_E2E.md`. This is not live evidence.

### Automatic sync (2026-11-23)
- T2O changed-since feeds (members, answers, deletions) built as kunalsharma-ai/turn2opinion#20 (draft, not deployed).
- MADP `runSync`: reads only what changed, per-feed cursors, deletions remove contact details, answers and consents,
  answers that arrive before their member wait for it. Scheduler off by default (`SYNC_INTERVAL_MINUTES`).
- Connectors screen: sync health and "Sync changes now". Directory: membership, teen and guardian-consent filters.
- Tested: `apps/api/test/sync.test.ts` for all three panels, and end to end on the local T2O copy
  (`docs/T2O_LOCAL_E2E.md`). Go-live steps: `docs/T2O_GO_LIVE.md`.

### MFR and MHO end to end on local copies (2026-11-24)
The same backend copy served MFR and MHO as two more tenants. Import, consent, categories (including MHO teen
patients), MHO special-category answers, re-import and three sync runs all pass for both (`docs/T2O_LOCAL_E2E.md`).
Staff accounts are now skipped (`isStaff`, kunalsharma-ai/turn2opinion#21, merged, not deployed). Not live evidence.

### Cross-panel identity review (2026-11-24)
- Matches between panels stay candidates: a reviewer merges or rejects them on the new Identity review screen
  (`identity.review`, held by super admins, data stewards and privacy officers). Two verified e-mails still link
  automatically, and every link, automatic or reviewed, can be unmerged with a reason.
- A merge moves one panel account with its own panel membership, categories, consents and answers. Panels are never
  combined, and a person can't hold two live memberships of the same panel.
- Every merge and unmerge goes into an append-only `identity_link_event` table and the audit log.
- Source precedence: the person's country, state, city, gender and birth year come from their accounts in this order:
  deleted memberships ignored, verified e-mail first, latest source update, then first seen. `field_sources` records
  which account supplied each field. This replaces "first seen wins".
- Tests: `apps/api/test/identity.test.ts` (5) and `src/identity/precedence.test.ts` (3), on DEMO data.
### Signed webhooks and key rotation (2026-11-24)
- `POST /webhooks/:panel` takes signed "something changed" events from a panel and starts a sync of that panel.
  HMAC-SHA256, 5-minute replay window, event id idempotency, two secrets at once for rotation, and no personal data in
  the payload. Off for a panel until its secret is set. No panel sends webhooks yet, so scheduled sync stays the main
  path.
- Field-encryption keys can be rotated: several keys by id, one active, and `keys:rotate` re-encrypts stored values.
- Tests: `test/webhooks.test.ts` (7), `src/webhooks/signature.test.ts` (3), crypto and config unit tests.

### Stricter MHO controls (2026-11-24)
- Health answers need the health permission and a stated purpose, recorded in the audit log. This covers the profile
  screen and counts with health filters.
- A minor's MHO health answers stay hidden until the guardian's consent is granted on MHO.
- Health-filtered counts suppress cells below 10 (`SENSITIVE_MIN_CELL_SIZE`).
- Tests: `test/mho-controls.test.ts` (2), plus updated `platform` and `attributes` tests.

### Engagement studio, part 1 (2026-11-24)
- Templates per panel, with versions, automatic checks (known placeholders only, unsubscribe and preference links,
  no scripts), and review by a second person. Approved versions never change.
- Campaigns need an approved version and a second person's approval, and can be paused.
- Dry runs decide, member by member, who would get the message and when (outside their local quiet hours), or why
  not: membership not active, minor, opted out, no consent, no usable e-mail, bounced, already sent, weekly or
  monthly cap. Marketing messages need the e-mail marketing opt-in (see "Marketing e-mail opt-in" below); members
  who never ticked it are held back. Onboarding messages need the panel's terms.
- Per-person communication timeline with a transparent contact-load score per panel.
- Nothing is sent: there is no provider yet, and sending needs the owner's approval.
- Brand kits (sender, footer, logo, colours) are placeholders until each panel owner supplies them.
- Tests: `test/engagement.test.ts` (4) and `src/engagement/engagement.test.ts` (6).

### Engagement studio, part 2: calendar and lifecycle automations (2026-11-24)
- Celebration calendar per panel, reviewed by a second person. `civic` dates (a national day, the new year) go to
  members in the listed countries. `religious_cultural` dates go only to members who chose that greeting, because
  religion is never inferred from country. No panel records that choice yet, so those greetings reach nobody.
- Automations with versioned rules: trigger, segment, conditions, contact gate, approved template per step, e-mail,
  spacing and stop rule. A second person approves each version. A rollback restores an old version as a new draft
  that goes through review. Automations can be paused, resumed and archived. Each run is kept with its counts, and
  a failed run keeps its error and can simply be run again.
- Triggers:
  - Inactivity, with steps by days idle (for example 15, 30, 60 and 90). Activity means joining, a profile answer
    changing, or a real open or click. The panels do not export logins or survey completions yet. A step is never
    repeated, and the ladder starts over once the member is active again.
  - Incomplete profile: below a completion share, or missing required questions. The run reports the most-missed
    required questions. It stops once the profile is complete.
  - Registration: steps by days since joining, each due only in its first week. Later steps can be limited to
    members whose profile is still incomplete.
  - Birthday, on the member's local date. 29 February birthdays are greeted on 28 February in other years.
  - Calendar greeting, from an approved calendar date.
- Every step passes the same contact gate as campaigns, plus spacing between messages from one automation.
- Survey invitation reminders wait until MADP sends the invitations that Supply360 authorises.
- Frequency caps count queued, sent and delivered messages, and ignore events after the run's date. Opens and
  clicks count as activity, not as extra contacts.
- Admin screen: Engagement → Lifecycle automations, with the builder, versions, dry runs and the calendar.
- Tests: `test/automations.test.ts` (9, on all three panels) and unit tests for dates and the gate.

### Loyalty ledger mirror and reconciliation (2026-11-24)
- The T2O backend now serves admin-only feeds of reward rows and survey responses
  (`/api/v1/changes/rewards` and `/changes/responses`, turn2opinion#24, merged, not deployed). Free-text reward
  remarks, response telemetry and review notes are left out.
- MADP mirrors each panel's wallet read-only, with one account per panel membership. Balances are never added
  across panels, even for one person. Nothing in MADP writes to a panel wallet.
- The ledger is append-only (a database trigger rejects edits and deletes). A change at the panel adds lines that
  move points between pending, approved, reversed and redeemed, so reading a feed again never books anything twice.
- Credited panel rewards mirror as approved. Survey completes stay pending until someone with `loyalty.approve`
  records the client's approval for that survey. A complete that later becomes a terminate, or is deleted, is
  reversed.
- The mirror runs after every import and sync. A panel that does not serve the feeds yet is reported as not
  supported, and the sync still succeeds.
- Reconciliation reads both feeds in full and compares every row with the ledger: rows missing, rows that differ,
  rows of members MADP does not know, and rows only MADP still holds. It also compares the panel's own balance rule
  (credited rewards plus complete survey points) with MADP's approved plus pending. Repair books the differences
  and reverses rows the panel no longer has. Every run is kept.
- The liability report gives points per panel and bucket. There is no money value, because the panels do not record
  one, and no redemptions, because the panels have none yet.
- Survey responses are kept per membership and count as activity for inactivity automations. A removed member's
  survey history is deleted; their ledger lines stay, because reward liabilities must stay auditable.
- Admin screens: Loyalty → Loyalty ledger, and reward wallets on the 360° profile.
- Tests: `test/loyalty.test.ts` (6, all three panels), `src/loyalty/position.test.ts` (4), and connector mapping.

### Profile freshness and missing attributes (2026-11-24)
- Per panel, never added across panels: active accounts, members with any answer, never profiled, and members
  due for their 6-month check. Kunal's rule says data is rechecked every 6 months, so the window defaults to 180
  days and can be changed per view. Also shows bands for the share of the question bank answered, the 10
  least-answered questions with their stale answers, and coverage of each canonical attribute through approved
  mappings only.
- Counts only. Health questions and attributes are left out without `health.sensitive.read`, and the screen
  says how many were left out.
- The "Still true?" review and the archive of inactive members belong to the super admin console's Members module.
- Admin screen: Data → Profile freshness. Tests: `test/freshness.test.ts` (4, all three panels).

### Geography explorer, world map and overlap (screens 2 to 4, 2026-11-24)
- A world map (server-rendered SVG from Natural Earth via `world-atlas`, no client script) shades countries by
  unique people; each country links to its drill-down. Country, then state or province, then city, each with
  unique people and the T2O, MFR and MHO split, and the time zones members gave.
- A person counts once, at the place chosen by source precedence; the panel columns count each panel's members.
  Cells under `MIN_CELL_SIZE` are hidden (`SENSITIVE_MIN_CELL_SIZE` with a health filter, which also needs a purpose
  and is audited, as with counts).
- Overlap: people by the exact panels they hold, and a five-category matrix (the diagonal is everyone in the
  category).
- API: `POST /audience/geo` and `POST /audience/overlap` (`audience.counts.read`).
- Admin screen: Audience → Geography & overlap. Tests: `test/geo.test.ts` (4, all three panels).

### AI insights and reviewable recommendations (screen 34, 2026-11-24)
- Twelve fixed, documented rules run per panel over MADP's own counts: low reachability, profiles due for the
  6-month check, never profiled, low quality scores, shared e-mails, identity review backlog, pending mappings,
  pending survey points, stale sync, failed syncs, overdue privacy requests and evidence expiring within 30 days.
- No AI model is called, per the owner's rule. A language model can be added later only with approval and would see
  counts only. Insights hold counts and shares, never personal data.
- A refresh updates open insights instead of duplicating them, resolves those whose rule stopped firing, and keeps
  an accepted or dismissed insight quiet for 7 days. A person accepts or dismisses each insight with a note;
  nothing is acted on automatically. Refreshes and decisions are audited.
- Permissions `insights.read` (super admin, brand admin, panel manager, data steward, privacy officer, platform
  admin, analyst) and `insights.review` (the same without platform admin and analyst). Migration 0014.
- Admin screen: Overview → AI insights. Tests: `test/insights.test.ts` (5, all three panels).

### Reports, analytics and exports (screens 23 and 29, 2026-11-24)
- A report registry (`src/reports/reports.service.ts`): each report is one table, per panel and never added across
  panels, with its own permission. Other modules add a report by adding an entry.
- Nine reports: audience by category, audience by country and state (small cells blank below `MIN_CELL_SIZE`),
  consent funnel, data quality checks, profile freshness, loyalty liability valued at each brand's points rate
  (1,000 points = 1 USD unless changed in Brands & settings), campaign delivery (screen 23), privacy requests and
  deadlines, and sync health. Delivery, privacy and sync reports take a period (last 30 days by default).
- CSV and Excel downloads need `export.read`, carry `data_mode` on every row (Excel also gets an About sheet and a
  "(DEMO)" sheet name), escape cells a spreadsheet would run as formulas, and are audited as `report.exported`.
  A report holding personal data would also need `export.pii`; none does.
- Brand scoped like the other screens. Roles: analyst, data steward and privacy officer gain `reports.read` and
  `export.read`; platform admin gains `reports.read` (migration 0013).
- Admin screen: Overview → Reports & exports. Tests: `test/reports.test.ts` (8, all three panels).

### Verification and data quality center (screen 8, 2026-11-24)
- Per panel, never added across panels: e-mail and phone verification and quality-score bands exactly as each
  panel reported them (labelled source-reported), open identity matches, and ten MADP checks on active members:
  no country, no birth year, age outside 13 to 120, no or unknown time zone, no e-mail, e-mail rejected by the
  panel, an e-mail shared by two or more members of the same panel, quality below the starting score of 100, and
  no quality score. Thresholds come from the T2O and MFR audits.
- A drill-down lists who fails a check with person ids and masked panel ids only (needs `panellists.read`).
- Independent verification evidence (identity, age, HCP licence, employment): one admin records the check with a
  method, a reference with no personal data and an optional expiry; a different admin verifies or rejects it;
  verified evidence can be revoked, and expired evidence is counted apart. Every step is audited. Evidence is tied
  to the panel membership, so identity merges carry it, and a privacy deletion erases it. Access exports include it.
- Works in the brand picked in the brand switcher (`@BrandScoped`), or every brand side by side.
- New permissions `verification.read` (super admin, brand admin, panel manager, data steward, privacy officer) and
  `verification.review` (the same without panel manager). Migration 0012.
- The console's Quality module (panel-side quality actions) is separate and writes to the panels; this center
  only reads MADP's copy and records MADP's own evidence.
- Admin screen: Data → Verification & quality. Tests: `test/verification.test.ts` (5, all three panels).

### Privacy requests and retention (2026-11-24)
- Access, correction, deletion and restriction requests, each with a jurisdiction, a due date set by counsel
  (30 days unless stated), an overdue flag, and an append-only trail.
- Support logs a request. A privacy officer verifies the requester and carries it out, and never for a request
  they logged themselves.
- Deletion erases MADP's copy at once, using the same path as a panel deletion. It clears contact details,
  answers, consents and survey history, and keeps reward ledger lines for liability. An erasure hold keeps the
  member out of later imports and syncs. The request waits until the panel's own deletions feed confirms the
  member is gone, then closes itself. MADP never deletes anything at a panel.
- An access request gives a decrypted JSON export of everything MADP holds on the request's panels. It needs PII
  and health permissions and is audited. Restriction opts the member out of every channel on those panels.
  Correction is forwarded to the panel and closed once the panel has made it.
- Retention schedule: audit, consent history and the reward ledger are kept as evidence. The audit periods are
  marked [Confirm with counsel]. Only Supply360 idempotency answers and old dry-run messages can be purged.
- Admin screen: Governance → Privacy requests. Tests: `test/privacy.test.ts` (6, all three panels).

### Consent and preference center (2026-11-24)
- Consent comes from the panels. MADP shows it per panel and purpose, never added across panels, with a
  contactability funnel: accounts, active, adults, terms accepted, usable e-mail, not opted out, reachable.
- Every change to a consent record is appended to `consent_event` by a database trigger, whichever code path made
  it, including deletions and identity merges. A re-read that only names a new import job is not a change. The
  history cannot be edited or deleted.
- Members can ask MADP to stop contacting them on a channel (e-mail, SMS, push, WhatsApp or all). Support and the
  privacy officer record it with a reference and no personal data, and the contact gate, campaigns, automations
  and Supply360 honour it. Lifting it only removes MADP's own opt-out, adds a new line, and never grants consent.
- Gaps are shown per panel. Since the marketing opt-in is read, no panel is missing e-mail marketing consent on DEMO
  data.
- Admin screen: Governance → Consent & preferences. Tests: `test/consent.test.ts` (4, all three panels).

### Supply360 service API (Milestone 6, 2026-11-24)
- Supply360 calls MADP as a signed service client: HMAC over method, path and body, a 300 s clock window, nonces
  used once, scopes, allowed panels and a rate limit per client. Every refusal is audited with its reason.
- Counts, a catalogue, and match: eligible members as random pseudonymous refs per client, with panel, categories
  and country for quotas. No names, addresses, answers or health data. Below the minimum cell no refs are returned,
  and match refuses health criteria. Health counts need a separate scope and the study feasibility purpose.
- Reservations hold members for one project for up to 14 days, and other projects cannot hold or match them.
- Invitation authorisation checks consent and the contact rules again and records invitations. Nothing is sent.
- Participation events are idempotent by event id, mark the invitation's status and first click, and credit no
  rewards. A consent check answers per ref and purpose.
- Writes take an idempotency key. Admins create and revoke clients (the secret is shown once and stored encrypted)
  on Supply360 → Supply360 console, with activity counts per client.
- Tests: `test/supply360.test.ts` (13, all three panels).
- Not yet: invitation delivery and reminders, which need approval to send; a live Supply360 client.

### Next for T2O
A T2O-only dry run against the live backend once the token is in the cloud environment, with counts shown to Kunal
before any write.


## Milestone 2, part 1: work that does not need live access (2026-11-23)

### Completed and tested
- Connector retry with exponential backoff, jitter and `Retry-After`; never retries refused access.
- Dead-letter queue for answer batches that fail after retries, with a retry action on the Connectors screen.
- Reconciliation report per import, with pass/fail checks (`/connectors/imports/[id]` in the admin app).
- Attribute-level audience filters through approved mappings only; special-category filters gated and audited.
- Value maps on mapping decisions, validated against the question version's options; editor in the workbench.

### Test results (2026-11-23)
| Suite | Result |
|---|---|
| `pnpm build`, `pnpm typecheck` | pass |
| `pnpm test` | contracts 3, config 4, testing 2, connectors 24, api 4 — all pass |
| `pnpm test:integration` | api 28 — all pass (platform 19, resilience 3, attributes 6) |

### Still blocked for the rest of M2
Live read-only approval and credentials per panel, production hosts, the MFR definitions export, the MHO image.
All data remains DEMO.


## Milestone 1: discovery and foundation (2026-11-23)

### Completed and tested
- Read-only audits of T2O, MFR and MHO (`docs/REPOSITORY_AUDIT_*.md`). No panel repository was changed.
- Monorepo on pinned latest stable versions (`docs/TECHNOLOGY_VERSIONS.md`).
- Postgres schema with migrations, append-only audit trigger, MongoDB collections.
- Auth: argon2id, lockout, TOTP MFA required, six RBAC roles, ABAC for PII and health answers.
- Connectors for all three panels: a DEMO connector, plus LIVE HTTP adapters for the audited routes with contract tests.
  LIVE is locked until approved.
- Ingestion: dry run, idempotent, resumable, versioned questions, mapping queue, identities, memberships, answers
  with history, checkpoints, outbox.
- Identity: auto-link only on verified e-mail hash matches; everything else goes to review.
- Audience counts: unique people vs panel memberships vs category memberships, small-cell suppression, freshness.
- Admin console: login and MFA enrolment, dashboard, audience explorer, connectors and imports, question registry,
  mapping review, panellist directory and 360 view, audit log, command palette, dark mode, mobile layout.
- Local Docker compose, Dockerfiles, CI workflow.

### Test results (last run 2026-11-23)
| Suite | Result |
|---|---|
| `pnpm build` | 6/6 tasks pass |
| `pnpm typecheck` | pass |
| `pnpm test` | contracts 3, config 4, testing 2, connectors 20, api 4 — all pass |
| `pnpm test:integration` | api 19 — all pass (real Postgres 18 and Mongo 8) |

### Demo run
`pnpm db:migrate && pnpm db:seed:demo` imported DEMO data for each panel: T2O 567, MFR 597 and MHO 608 people, which
is **1,500 unique people and 1,658 panel memberships**. All of it is labelled DEMO and none of it is real.
Screenshots are in `docs/screenshots/`.

### Pending
- Everything in M2–M6 (`docs/IMPLEMENTATION_PLAN.md`).
- Consent population, deletion propagation, webhook ingress, merge and unmerge (M3).
- Nonce-based CSP for the admin app (M2).

### Blocked (needs Kunal)
- Live read-only access approval and a scoped integration credential for each panel.
- Production origin host for each panel.
- MFR question definitions export.
- Which backend MHO production actually runs.

### Known limitations
- No panel has been contacted. Every count shown is DEMO.
- MFR question labels are placeholders because the definitions are not in the repo.
- The Docker image builds of `apps/api` and `apps/admin` were not verified: Docker Hub rate-limited the base image pull
  (HTTP 429) in the build sandbox. The compose data services were verified.
- Not deployed anywhere.

## Super admin step 3a: segments, audiences, surveys, points, quality, referrals (24 Nov 2026)

- Panel side (kunalsharma-ai/MFR#51, merged, not deployed): `/api/admin/v1` segments, audiences, surveys and
  invitations, points adjustments and holds, quality score changes, referral fraud view.
- MADP: `SegmentsController`, `SurveysController`, `PointsQualityController` and question bank versions and translations.
  Every write is audited with old and new values and a reason. Reads that show member names are audited.
- Four eyes: adjustments at or above the brand's `fourEyesPoints` (default 50,000) wait for a second admin; the panel
  refuses the requester.
- Invitations are dry runs by default and never send e-mail. A real run needs `invitations.send` and a reason.
- Screens: Segments & audiences, Surveys (list and detail with invite and reconcile), Points approvals, Quality &
  referrals, member points and quality card, question bank Versions tab.
- Tests: `apps/api/test/panel-admin-step3.test.ts` (6), MFR `tests/admin.step3.test.mjs` (6).
- Previews: `/mnt/project-files/madp/preview-console/step3a-segments-surveys-points-quality/` (DEMO data).
- Not done: the T2O and MHO columns need their panel admin API connected (step 6). Live verification waits for deploy.

## Super admin step 3b: ticket desk, portal messages, help centre (24 Nov 2026)

- Panel side (kunalsharma-ai/MFR#52, merged, not deployed): `/api/admin/v1` tickets, messages and help. Members get
  portal messages from `GET /api/v1/alerts` (the bell and Messages page already called it) and published help entries
  from `GET /api/v1/help`.
- MADP: `SupportAdminController`. Nothing is e-mailed. Ticket replies and notes are audited without their text.
  A message that reaches teens needs `teen.read`; a ticket from a teen needs `teen.read`.
- Screens: Ticket desk (list and detail), Portal messages, Help centre.
- Tests: `apps/api/test/panel-admin-step3b.test.ts` (3), MFR `tests/admin.step3b.test.mjs` (3).

## Super admin step 4: feature switches, rewards, engagement, Teen Panel, data requests (24 Nov 2026)

- Panel side (kunalsharma-ai/MFR#53, merged, not deployed): a per-brand `FeatureSwitch` collection. Every money, legal
  and e-mail feature asks the switch when it acts. That covers redemptions, teen learning rewards, the prize draw,
  push, and the welcome, new-user, new-survey, birthday, lifecycle, weekly and expiry e-mails. The brand's kill switch
  turns them all off. The defaults are unchanged, so everything is still off on every brand.
- `/api/admin/v1` covers:
  - switches
  - the rewards catalogue and redemption queue
  - draws and offers
  - engagement tasks, ideas, stories and streaks
  - teens (turning 18, guardian links)
  - data requests (no code deletes anything)
- MADP: `RewardsAdminController`.
  - Switches: `switches.flip` plus the Super Admin role on that brand, with a reason.
  - Redemptions: marking one paid needs `payouts.approve`. At the brand's four-eyes amount, the admin who approved it
    can't also mark it paid. A teen's request needs `teen.read`.
  - Teen ideas need `teen.review`.
  - Turning 18 needs `teen.review` and `segments.manage`. A dry run comes first, and the real move is audited.
  - Data requests need `data_requests.manage`.
- Screens: Feature switches, Rewards, Engagement, Teen Panel (turning 18), Data requests.
- Tests: `apps/api/test/panel-admin-step4.test.ts` (5) and MFR `tests/admin.step4.test.mjs` (6).
- Nothing was switched on, sent or paid. Turning a switch on in production waits for Kunal.

## Marketing e-mail opt-in read (24 Nov 2026)

- Kunal's decision: only the explicit "Send me news and offers" box counts as `email_marketing` consent. The MFR
  "news-letter" profile answer and a `marketing` id in `User.terms` never do.
- Panel side: shared backend `User.marketingOptIn { granted, at, source, wording }` and `marketingOptInHistory`
  (kunalsharma-ai/MFR#54), sign-up forms in kunalsharma-ai/MHO#13. Both merged, not deployed.
- MADP (`mapConsents`): a tick is `granted`; unticked at sign-up is `denied`; switched off later (profile or admin) is
  `withdrawn`; never asked means no record, which counts as no. Evidence keeps the wording and source
  (`news-offers-v1@signup`), never more. Teens can't opt in at the panel.
- Members screen: a Marketing column, a filter (opted in, declined or withdrawn, never asked) passed to
  `/api/admin/v1/members?marketing=`, and the opt-in with its history on the member page.
- DEMO data: adults get an opt-in record from a separate random stream (about 30% opted in, a third never asked), so
  every other DEMO value is unchanged.
- Read path per panel: MFR and MHO read the field from `GET /api/v1/user` (the field is on the record). The T2O
  repository has no opt-in yet, and its changes feed (`MEMBER_FIELDS`) needs `marketingOptIn` added: asked of the
  panel-repo work.
- Tests: `packages/connectors/src/consents.test.ts` (4 new), and consent, engagement, automations and Supply360 now
  check that only opted-in members are planned or eligible.

## Super admin step 4b: Teen registration pipeline and turning 18 (24 Nov 2026)

Panel side is kunalsharma-ai/MFR#55 (merged, not deployed).

- **Teen registrations** (`/teens/registrations`) shows counts for all eleven statuses and the open registrations, with
  guardian e-mails masked. Support can approve a manual review, cancel an open registration, or renew an expired guardian
  invitation. Each needs a reason (`teen.review`) and is audited as `teen.registration.<action>`.
- **Turning 18** (`/teens`) has three lists: turning 18 in 30 days, waiting to accept adult terms, and every teen.
  - "Move now" asks for Consumer or Business Professional and needs `teen.review` and `segments.manage`.
  - "Close account" needs `teen.review`.
  - On the panel:
    - The 30-day notice and the guardian's "consent ended" e-mail sit behind the new `email_turning18` switch, which is off.
    - On the birthday the account pauses until the member accepts the adult terms on `/member/adult`. Parent-answered
      answers and guardian details are deleted on the move.
    - After 60 days the account closes. Points lapse and a delete request opens.
- Tests: `panel-admin-step4.test.ts` has 6 passing, against the stand-in panel. On MFR, `admin.step4b.test.mjs` has 8 passing.
