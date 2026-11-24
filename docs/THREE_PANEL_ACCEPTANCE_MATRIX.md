# Three-panel acceptance matrix

Spec §17. A column is ✅ only with real evidence from that panel's **live, authorised** data. DEMO runs and stub
contract tests are recorded as evidence of readiness, not as a pass.

Legend: ✅ passed with live evidence · 🟡 implemented and tested on DEMO or stub only · 🔶 partly implemented ·
⛔ blocked on access or approval · ❌ not started.

**As of 2026-11-24, no column has passed for any panel.** Columns 3 to 14 have also run end to end against a local
copy of the panel backend for all three panels (`T2O_LOCAL_E2E.md`); that is still not live evidence.

| Column | T2O | MFR | MHO |
|---|---|---|---|
| 1. Repository audited | ✅ code audit at `REPOSITORY_AUDIT_T2O.md` | ✅ production runs the T2O backend (confirmed), which is audited | ✅ production runs the T2O backend (confirmed), which is audited |
| 2. Auth tested | ⛔ no approved credential | ⛔ | ⛔ |
| 3. Questionnaires imported | 🟡 DEMO, real definitions from the repo | 🟡 DEMO, placeholder definitions | 🟡 DEMO, real definitions from the repo exports |
| 4. Question versions imported | 🟡 | 🟡 | 🟡 |
| 5. Options imported | 🟡 | 🟡 | 🟡 |
| 6. Respondent identities imported | 🟡 synthetic people | 🟡 | 🟡 |
| 7. Answers imported | 🟡 synthetic answers | 🟡 | 🟡 |
| 8. Consent synchronised | 🟡 DEMO: guardian consent, terms and opt-ins from `User` fields, one current record per purpose | 🟡 DEMO, same backend `User` fields; consent stored as answers (`terms-consent`, `news-letter`) not yet read | 🟡 DEMO, same backend `User` fields; no health-data consent field exists at source |
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
| Privacy requests (access, correction, deletion with erasure hold, restriction) and retention | 🟡 DEMO, `test/privacy.test.ts`; panel deletion confirmed through the deletions feed | 🟡 DEMO | 🟡 DEMO |
| Supply360 service API (counts, match, reservations, invitation authorisation, events, consent) | 🟡 DEMO, `test/supply360.test.ts` | 🟡 DEMO | 🟡 DEMO; health criteria refused in match, health counts only with the health scope |

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
