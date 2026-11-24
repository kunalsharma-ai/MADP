# Progress

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
  monthly cap. Marketing messages need an e-mail marketing consent. No panel exports one yet, so every marketing
  dry run holds everyone back; onboarding messages need the panel's terms.
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
