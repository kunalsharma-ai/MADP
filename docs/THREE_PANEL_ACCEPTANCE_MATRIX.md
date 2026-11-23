# Three-panel acceptance matrix

Spec §17. A column is ✅ only with real evidence from that panel's **live, authorised** data. DEMO runs and stub
contract tests are recorded as evidence of readiness, not as a pass.

Legend: ✅ passed with live evidence · 🟡 implemented and tested on DEMO or stub only · 🔶 partly implemented ·
⛔ blocked on access or approval · ❌ not started.

**As of 2026-11-23 (Milestone 2, part 1), no column has passed for any panel.**

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
| 9. Updates synchronised | 🔶 re-import is idempotent; no updated-since source | 🔶 | 🔶 |
| 10. Deletion propagated | ❌ no source event (G-05) | ❌ | ❌ |
| 11. Webhook or polling verified | ❌ | ❌ | ❌ |
| 12. Source provenance preserved | 🟡 source member id, question version, import job | 🟡 | 🟡 |
| 13. Mappings reviewed | 🔶 review queue and value maps work; no live mapping reviewed yet | 🔶 | 🔶 |
| 14. Counts reconciled | 🟡 reconciliation report with checks, DEMO only | 🟡 | 🟡 |
| 15. Integration health visible | 🟡 Connectors page and `/integrations/health` | 🟡 | 🟡 |
| 16. Automated contract tests passing | 🟡 stub of audited routes | 🟡 | 🟡 |

## Evidence
- Integration tests: `apps/api/test/platform.test.ts` (19), `resilience.test.ts` (3, dead letters and reconciliation),
  `attributes.test.ts` (6, attribute filters and value maps).
- Connector contract tests: `packages/connectors/src/connectors.test.ts` (24, including retry and backoff).
- Screenshots: `docs/screenshots/05-connectors.png` and `06-questions.png`.

## Journeys (spec §17)
| Journey | Status |
|---|---|
| T2O: registration → membership → consumer/B2B schema → answers → canonical attributes → counts → profile sync → engagement | DEMO up to counts; sync and engagement not started |
| MFR: … → separate MFR reward ledger → profile sync → engagement | DEMO up to counts; ledger is M5 |
| MHO: … → consent-aware restricted health attributes → counts → profile sync → healthcare engagement | DEMO up to counts with health answers restricted; consent and engagement not started |
