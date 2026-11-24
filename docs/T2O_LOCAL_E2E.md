# T2O end-to-end check on a local copy (2026-11-23)

Kunal asked to test Turn2Opinion without production access, using test accounts for a consumer, a business
professional and a teen. Signing up on www.turn2opinion.com would have sent real e-mails, including one to a parent,
and added test people to real member counts. So the check ran against a copy of the T2O backend instead
(`Project/backend` from the T2O repo, unchanged). The copy had its own database and loaded the full question bank.
How to repeat it: `tools/t2o-local/README.md`.

**This is not live evidence.** The acceptance matrix stays 🟡 until the same test runs against production with
an approved credential.

## Accounts, created through T2O's own endpoints

| Account | How it was created |
|---|---|
| Consumer (`b2c`) | Sign-up, e-mail code, set password, then 7 profile answers through `/me/profile` |
| Business professional (`b2b`) | Same flow, 4 profile answers |
| Teen, guardian approved (`minor`) | Teen sign-up with a mother's details, guardian YES, onboarding form, consent form, teen activation link, 10 answers |
| Teen, guardian not yet decided (`minor`) | Teen sign-up only; the guardian has not opened the link |

## MADP results

| Step | Result |
|---|---|
| Dry run | 50 sections, 848 questions, 4 members read; nothing written |
| Import | 4 people, 4 identities, 26 answers, 18 consent records; reconciliation: all 4 checks pass |
| Categories | b2c → Consumer, b2b → Business Professional, both teens → Consumer, flagged minor |
| Guardian consent | approved teen → granted; waiting teen → unknown; adults → no guardian record |
| Other consent | terms granted for all; push notifications granted only where the member opted in |
| Contact details as answers | none stored (mail, phone, first name, date of birth) |
| Re-import | idempotent: 0 new identities, consent rows or answers |

## What the check found

Fixed in MADP:
- The backend returns a default `parent` object for every member. MADP was creating an "unknown" guardian record for
  adults. It now creates one only for teens or when a status was recorded.
- Two bank sections (`shopping`, `food-beverages`) have a blank question slot, which stopped the import. MADP now
  skips blank names. The bank has 848 named questions, not 849.

In the T2O panel (fixed in kunalsharma-ai/turn2opinion#16, awaiting review):
- **T2O-BUG-01:** the guardian's consent step fails part-way, and the teen gets no activation link. See
  `REPOSITORY_AUDIT_T2O.md`.
- **T2O-SEC-03 confirmed:** an ordinary member's login token lists every member, including teens' guardian e-mails,
  and reads other members' answers. MADP's import worked with a plain member token. For production, use a dedicated
  admin or integration account, and the panel should restrict these routes.

## After the T2O fixes (kunalsharma-ai/turn2opinion#16, 2026-11-23)

Kunal asked for both panel problems to be fixed. The T2O pull request is open for review and has not been deployed.
The same copy was run on that branch:
- **Teen activation:** with the old index present, start-up dropped it, and a new teen completed sign-up, guardian
  YES, onboarding, consent and password set-up with no error.
- **Member data:** all 25 before/after access rules pass. A member gets 403 for other members' data and keeps their
  own pages. Anonymous calls to admin routes get 401.
- **MADP with a dedicated admin integration account:** dry run, import (6 members, 27 consent records),
  reconciliation and re-import all pass. A member token now fails loudly (403, `not_authorised`) instead of importing
  nothing, because MADP reads members with `GET /api/v1/user`.
- **The integration account itself is imported as a member.** The panel does not expose the role to MADP. Until it
  does, exclude that account by its id.

## Automatic sync from the changes feed (kunalsharma-ai/turn2opinion#20, 2026-11-23)

The copy was run with the #20 feeds. After the import, the test made three changes in T2O through its own routes
(the consumer changed an answer with `PATCH /me/profile`, the admin account reset one test member's answers with
`POST /user/refresh` and deleted another with `DELETE /user/:id`), then ran MADP's sync:

| Run | Started from | Members | Answers read | Answers changed | Removed | Answer resets |
|---|---|---|---|---|---|---|
| 1 (right after the import) | 10 min before the import started | 1 | 1 | 2 | 0 | 1 |
| 2 (after the three changes) | each feed's cursor | 1 | 1 | 5 | 1 | 1 |
| 3 (nothing new) | each feed's cursor | 0 | 0 | 0 | 0 | 0 |

Run 1 picked up changes made by an earlier test run inside the 10-minute overlap, which is what the overlap is for;
storing them again changed nothing that was already right. After run 2 the consumer's new answer was in MADP, the
deleted member had no contact details, a `deleted` membership and no answers, and the reset member had no current
answers. All four tests passed (`apps/api/test/t2o-local.test.ts`, 11 minutes).

## Timing

Each import reads 848 option lists, one request every 250 ms, so about 3.5 minutes per run. A paged or bulk
options route on the panel would remove most of that.

## MFR and MHO on the same backend copy (2026-11-24)

All three panels run the T2O backend, with the Host header as the tenant key. So the same local copy served
`mfr.localhost` and `mho.localhost` as two more tenants, each with its own bank (from MADP's fixtures) and
`scripts/golive-setup.js` applied. A token from one tenant gets 403 on the other two. The accounts were made with
`tools/t2o-local/panel-accounts.mjs` through the panel's own sign-up, e-mail code, guardian and activation routes,
plus one admin integration account per panel. The test is the same file, run with `T2O_LOCAL_PANEL=mfr` or `mho`.
**This is not live evidence.**

| Step | MFR | MHO |
|---|---|---|
| Accounts | consumer (`b2c`), professional (`b2b`), teen with guardian YES, teen waiting (both `minor`) | healthcare professional, patient, care giver, teen patient with guardian YES, teen patient waiting (both `minor patient`) |
| Dry run | 2 sections, 9 questions, 4 members; integration account left out | 4 sections, 35 questions, 5 members; integration account left out |
| Import | 4 people, 15 answers, 18 consent records; reconciliation 4 of 4 | 5 people, 18 answers, 22 consent records; reconciliation 4 of 4 |
| Categories | b2c → Consumer, b2b → Business Professional, teens → Consumer, flagged minor | → Healthcare Professional, Patient, Caregiver; teens → Patient, flagged minor |
| Guardian consent | approved teen granted, waiting teen unknown | same |
| MHO answers | n/a | special-category unless the question is a demographic one or asked only of healthcare professionals |
| Re-import | idempotent | idempotent |
| Sync, 3 runs | run 2 picked up the changed answer, 1 removal and 1 answer reset; run 3 read nothing | same |

All four tests passed for each panel. The MFR bank is the placeholder fixture (2 sections), because the MFR question
definitions are not in the repo.

Found and fixed in the panel backend (kunalsharma-ai/turn2opinion#21, merged, not deployed):
- `golive-setup.js` created the T2O member types for MHO. It now creates `healthcare professional`, `patient`,
  `care giver` and `minor patient`.
- An MHO teen patient was stored as `minor`. It is now `minor patient`, and the guardian reminders, the teen checks
  and the registration status accept both.
- The integration account was imported as a member. The admin member list and the members feed now carry `isStaff`,
  and MADP skips staff accounts (`staffSkipped` in the import counts).
