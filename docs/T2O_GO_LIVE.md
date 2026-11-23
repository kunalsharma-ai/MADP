# Turn2Opinion go-live checklist (2026-11-23)

What has to be true for the new Turn2Opinion portal to go live with MADP syncing its data automatically. Everything
below was tested on a local copy of the T2O backend and frontend, with test accounts only. Nothing has been deployed
and no production data has been read.

## 1. Merge and deploy the T2O changes (owner)

| T2O pull request | What it does | Status |
|---|---|---|
| #16 | Member data lock-down (admin-only member routes) and the teen activation fix | open, not deployed |
| #18 | Help page, Profiles freeze, Teen islands freeze, points threshold, empty answers saved for text questions, go-live setup script | draft, not deployed |
| #20 | Changed-since feeds for MADP: changed members, changed answers, deletions | draft, not deployed |

#18 and #20 both merge cleanly into `Main` today. #20 adds `{origin, updatedAt, _id}` indexes on `User`, `Answer`
and `Tombstone`; Mongoose builds them on the first start.

## 2. Prepare each panel database (owner, once per panel)

```bash
mongodb=<panel database URI> node scripts/golive-setup.js --origin <panel host>          # dry run: shows what is missing
mongodb=<panel database URI> node scripts/golive-setup.js --origin <panel host> --apply  # adds only what is missing
```

It adds the three member categories (`b2c`, `b2b`, `minor`) and the support-ticket number sequence if they are not
there. It never changes an existing record.

## 3. Things the code cannot fix (owner)

- **Profile picture upload.** `/api/v1/upload/image` is not served by the backend; it needs the storage service and a
  gateway route. The old member app uses the same route.
- **Gateway rule for the member pages.** The ten `/member/...` URLs need the `try_files $uri $uri/ $uri.html` rule
  (or the static export's 404 page) so a refresh does not 404.
- **Social sign-on** answers 500 "Social signon is not allowed": it is switched off in configuration.
- **Sign-out** only clears the cookie. A copied token keeps working until it expires.
- **Answers are not checked against the options.** `PATCH /me/profile` stores any text for a select question.

## 4. Connect MADP (owner gives the go-ahead; nothing here runs before that)

1. Create a dedicated MADP admin account on the panel (not a member account: after #16 a member token gets 403).
2. Put its token and the panel URL in the MADP environment's secrets (`T2O_API_TOKEN`, `T2O_API_BASE_URL`). Never in
   chat or in the repository.
3. Add `t2o` to `LIVE_SOURCE_APPROVED_PANELS`.
4. Run a **dry run** from the Connectors screen and share the counts before anything is written.
5. Run the full import once. Check its reconciliation report.
6. Set `SYNC_INTERVAL_MINUTES` (5 is a good start). From then on MADP reads only what changed.

## 5. What automatic sync does

Every run, for each live panel that serves the feeds:

| Feed | MADP does |
|---|---|
| Changed members | Updates the member, their category and their consents (guardian consent for teens, terms, opt-ins). Soft-deleted members are removed as below. |
| Changed answers | Stores the new value and keeps the old one in history. Answers that arrive before their member wait and are read again once the member arrives. |
| Deletions | A deleted member keeps only the pseudonymous panel id: contact details and e-mail hash are cleared, the membership is marked removed (audiences leave them out), this panel's consents are withdrawn and this panel's answers are removed. An answer reset moves the answers to history. |

Each feed keeps its own cursor, so a run that stops part-way continues where it stopped. Two MADP servers never sync
the same panel at once. A panel without the feeds yet is reported as "feed not available" and asked again hourly.
The Connectors screen shows the schedule, the last run, its counts and any answers waiting for their member. The
panellist directory filters by membership status, teens and guardian consent.

## 6. Evidence

| Check | Where | Result |
|---|---|---|
| T2O unit tests | `npm test` in Project/backend (#20 branch) | 41 pass |
| T2O feeds on the local copy | walked every feed, compared with the database | 22 members, 159 of 181 answers (identifier questions left out), no duplicates; delete, refresh and a changed answer each appear once |
| MADP unit and contract tests | `pnpm -r run test` | all pass |
| MADP integration tests | `apps/api/test/sync.test.ts` and the rest | 39 pass, for all three panels |
| MADP against the local T2O copy | `apps/api/test/t2o-local.test.ts` | see `docs/T2O_LOCAL_E2E.md` |

This is not live evidence. The acceptance matrix stays unchanged until the live dry run.

## 7. MFR and MHO

Both run the same T2O backend in production, so the same three pull requests, the same setup script (with their own
`--origin`) and the same MADP sync apply to them, each with its own token and approval.
