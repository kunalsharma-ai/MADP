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
