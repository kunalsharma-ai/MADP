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
