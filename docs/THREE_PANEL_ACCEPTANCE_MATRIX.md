# Three-panel acceptance matrix

Spec §17. A column is ✅ only with real evidence from that panel's **live, authorised** data. DEMO runs and stub
contract tests are recorded as evidence of readiness, not as a pass.

Legend: ✅ passed with live evidence · 🟡 implemented and tested on DEMO or stub only · 🔶 partly implemented ·
⛔ blocked on access or approval · ❌ not started.

**As of 2026-11-24 (late), no column has passed for any panel.** Columns 3 to 14 have also run end to end against a local
copy of the panel backend for all three panels (`T2O_LOCAL_E2E.md`); that is still not live evidence. The console's
panel admin API (`/api/v1/admin`) is one API on the shared backend (MFR `main`) that serves all three brands by
`x-madp-origin`; its rows below are tested against a stand-in, not a deployed panel.

| Column | T2O | MFR | MHO |
|---|---|---|---|
| 1. Repository audited | ✅ code audit at `REPOSITORY_AUDIT_T2O.md` | ✅ production runs the T2O backend (confirmed), which is audited | ✅ production runs the T2O backend (confirmed), which is audited |
| 2. Auth tested | ⛔ no approved credential | ⛔ | ⛔ |
| 3. Questionnaires imported | 🟡 DEMO, real definitions from the repo | 🟡 DEMO, placeholder definitions | 🟡 DEMO, real definitions from the repo exports |
| 4. Question versions imported | 🟡 | 🟡 | 🟡 |
| 5. Options imported | 🟡 | 🟡 | 🟡 |
| 6. Respondent identities imported | 🟡 synthetic people | 🟡 | 🟡 |
| 7. Answers imported | 🟡 synthetic answers | 🟡 | 🟡 |
| 8. Consent synchronised | 🟡 DEMO: guardian consent, terms and opt-ins from `User` fields, one current record per purpose; marketing opt-in mapped and in the changes feed (turn2opinion#31, not deployed) | 🟡 DEMO, same backend `User` fields; marketing opt-in `User.marketingOptIn` (MFR#54) mapped as `email_marketing`; the `news-letter` answer is never consent | 🟡 DEMO, same backend `User` fields and marketing opt-in (MHO#13); no health-data consent field exists at source |
| 9. Updates synchronised | 🟡 changes feed (turn2opinion#20) and `runSync`, local copy | 🟡 same, local copy | 🟡 same, local copy |
| 10. Deletion propagated | 🟡 deletions feed, local copy | 🟡 | 🟡 |
| 11. Webhook or polling verified | 🟡 polling scheduler on the local copy; signed webhook intake built and tested on DEMO, but the panel does not send webhooks yet | 🟡 same | 🟡 same |
| 12. Source provenance preserved | 🟡 source member id, question version, import job | 🟡 | 🟡 |
| 13. Mappings reviewed | 🔶 review queue and value maps work; no live mapping reviewed yet | 🔶 | 🔶 |
| 14. Counts reconciled | 🟡 reconciliation report with checks, DEMO only | 🟡 | 🟡 |
| 15. Integration health visible | 🟡 Connectors page and `/integrations/health` | 🟡 | 🟡 |
| 16. Automated contract tests passing | 🟡 stub of audited routes | 🟡 | 🟡 |
| Consent and preference center (history, contactability, channel opt-outs) | 🟡 DEMO, `test/consent.test.ts` | 🟡 DEMO | 🟡 DEMO |
| Profile freshness and missing attributes (6-month check) | 🟡 DEMO, `test/freshness.test.ts` | 🟡 DEMO | 🟡 DEMO; health questions hidden without health access |
| Verification and data quality center, four-eyes evidence | 🟡 DEMO, `test/verification.test.ts` | 🟡 DEMO | 🟡 DEMO; HCP licence evidence |
| Reports and CSV/XLSX exports (9 reports, audited) | 🟡 DEMO, `test/reports.test.ts` | 🟡 DEMO | 🟡 DEMO |
| AI insights (rule-based, reviewed by a person) | 🟡 DEMO, `test/insights.test.ts` | 🟡 DEMO | 🟡 DEMO |
| Geography explorer, world map, panel and category overlap | 🟡 DEMO, `test/geo.test.ts` | 🟡 DEMO | 🟡 DEMO |
| Privacy requests (access, correction, deletion with erasure hold, restriction) and retention | 🟡 DEMO, `test/privacy.test.ts`; panel deletion confirmed through the deletions feed | 🟡 DEMO | 🟡 DEMO |
| Supply360 service API (counts, match, reservations, invitation authorisation, events, consent) | 🟡 DEMO, `test/supply360.test.ts` | 🟡 DEMO | 🟡 DEMO; health criteria refused in match, health counts only with the health scope |
| Questionnaire builder and review/publish (screens 11 and 12) | 🟡 stand-in panel only, `test/questionnaire.test.ts`; not run against a live panel | 🟡 same | 🟡 same |
| Super admin console through the panel admin API (members, question bank, surveys, points, rewards, prize machines, engagement, teens, tickets, messages, help, switches, the 11 step 5 reports), brand kept apart | 🟡 local panel backend with DEMO data: every console panel screen loads as T2O with no other brand's data (`step6-three-brands` previews); MFR `tests/admin.crossbrand.test.mjs` (MFR#59) | 🟡 same; MFR's own screens and tests since step 2 | 🟡 same; MHO segments (patient, healthcare professional, caregiver) shown with their labels |
| Mailer library (owner's packs, merge fields mapped, previews; nothing sent) | 🟡 22 templates, `test/mailers.test.ts` | 🟡 22 templates (lifecycle and system) | 🟡 54 templates for healthcare professionals, caregivers and patients |
| Mailer to studio template (campaign mailers become draft studio templates, studio review applies; nothing sent) | 🟡 DEMO, `test/mailer-studio.test.ts`; the two profile-reminder mailers need Liquid logic and are refused with the reason | 🟡 DEMO | 🟡 DEMO |
| Question bank Excel export and import (dry run first, formulas refused) | 🟡 stand-in panel, `test/qb-workbook.test.ts` | 🟡 stand-in panel; the MFR teen bank round-trips clean | 🟡 stand-in panel |
| Question versions (draft, review, publish by a second admin) and translations (teen guardrail on translations) | 🟡 stand-in panel, `test/panel-admin-step3.test.ts`, `test/qb-translations.test.ts`; panel side on MFR `main` (versions.js, MFR#66) | 🟡 same | 🟡 same |
| Site and legal pages editor (draft, review, publish by a second admin for legal pages, revisions) | 🟡 stand-in panel, `test/content-admin.test.ts`; panel side turn2opinion#33 | 🟡 same; MFR#64 | 🟡 same; MHO#15 |
| Production readiness: route security, token checks, headers, nonce CSP, CORS, throttling, OpenAPI coverage, restore drill, load test, every screen on a production build | 🟡 local and DEMO only: `test/security.test.ts`, `ops/backup/restore-drill.sh`, `ops/load/load-test.mjs` (p95 under 170 ms at 5,000 people, `PERFORMANCE.md`), 187-page production-build check; not deployed. Go-live list: `GO_LIVE.md` | 🟡 same | 🟡 same |

## Evidence
- Integration tests: `apps/api/test/platform.test.ts` (19), `resilience.test.ts` (3, dead letters and reconciliation),
  `attributes.test.ts` (6, attribute filters and value maps).
- Connector contract tests: `packages/connectors/src/connectors.test.ts` (24, including retry and backoff).
- Screenshots: `docs/screenshots/05-connectors.png` and `06-questions.png`.

## Journeys (spec §17)
| Journey | Status |
|---|---|
| T2O: registration → membership → consumer/B2B schema → answers → canonical attributes → counts → profile sync → engagement | DEMO up to counts; sync on the local copy; engagement campaigns and lifecycle automations as dry runs on DEMO, nothing sent |
| MFR: … → separate MFR reward ledger → profile sync → engagement | DEMO up to counts; sync on the local copy; engagement dry runs on DEMO; separate MFR wallet mirror and reconciliation on DEMO, feeds checked on the local copy |
| MHO: … → consent-aware restricted health attributes → counts → profile sync → healthcare engagement | DEMO up to counts with health answers restricted; engagement dry runs on DEMO; no health-data consent at source |
