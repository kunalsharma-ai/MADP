# Implementation plan

Follows spec §15. Every milestone ends with a pull request listing the files changed, commands run, test results,
screenshots, limitations and next actions. **No milestone may mark a panel integration complete without live evidence
recorded in `THREE_PANEL_ACCEPTANCE_MATRIX.md`.**

## M1 — Discovery and foundation (this PR)
Delivered: read-only audits of all three panels, the stack choice, the monorepo, auth with MFA and RBAC, migrations,
local Docker, the design system and admin shell, the docs and CI. On top of the M1 scope, a first vertical slice runs
on DEMO data: all three connectors (DEMO plus LIVE-ready HTTP adapters with contract tests), ingestion, identity
linking, overlap-safe counts, the question registry and mapping review, and the panellist 360 view.
**Gate:** build, typecheck, unit and integration tests are green, and the admin console runs end to end on DEMO data.

## M2 — All three panel connectors live (T2O, MFR and MHO in parallel)
Depends on approvals and credentials (gap analysis §3).
1. Dry run per panel against production with an approved read-only credential, and review the counts.
2. Full backfill per panel, plus a reconciliation report (source count vs imported vs rejected).
3. ✅ Retry with backoff and a dead-letter queue (done, DEMO and stub tested). BullMQ workers for backfills and
   Redis-cached counts once real volumes are known.
4. ✅ Attribute-level audience filters and a mapping UI with value maps (done, DEMO tested).
5. ✅ Reconciliation report per import (done, DEMO tested).
6. Contract tests recorded against each live API (sanitised and definitions only).
**Gate:** matrix columns 2–8 and 12–16 pass for **each** panel, with evidence.

## M3 — Cross-panel unification and validation
Identity review UI with merge and unmerge, consent sync per purpose and channel, deletion propagation, webhook ingress
(if panels add it) or cursor polling, source precedence rules, enhanced MHO controls (purpose-limited access, minor
handling), key rotation.
**Gate:** every matrix column passes for each panel. Each panel refreshes independently.

## M4 — Engagement
Template studio per brand, newsletters, birthday and festival calendar (admin-reviewed, never inferred from geography),
lifecycle automations, an automation builder with dry-run previews, provider adapters (sandbox only until approval),
communication timeline, fatigue score with visible factors, suppression, and invitation reminders that stop on click.
**Gate:** dry runs only. No real message is sent without explicit approval and configured credentials.

## M5 — Loyalty and advanced analytics
Per-panel loyalty accounts and an append-only reward ledger (read-only mirror of panel balances first), reconciliation,
liability reports, AI suggestions with human review, analytics dashboards.
**Gate:** no live wallet changes without approval. Balances reconcile with each panel.

## M6 — Supply360 and production readiness
Service clients, the Supply360 endpoints in `API_CONTRACTS.md` §4, contract tests, load and security tests, staging,
runbooks, backups and restore drills.
**Gate:** staging verification, then deployment with Kunal's approval.

## Acceptance tests per milestone
Each milestone adds integration tests to `apps/api/test/` and E2E checks with Playwright against the admin console.
