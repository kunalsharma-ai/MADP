# MADP Panel API Contract: every route

Generated from `packages/panel-contract/src/operations.ts` (contract 1.0.0). Do not edit by hand:
run `pnpm --filter @madp/panel-contract build && pnpm --filter @madp/panel-contract openapi`.

Auth: `bearer` = sync token, `signed` = x-madp-* signature, `either` = one of them. Personal = returns member data.


## `admin.audiences` Audiences

Saved audiences and their counts.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/audiences/count` | signed | yes |  | Count members for a filter (no ids) |
| GET | `/api/v1/admin/audiences` | signed |  |  | Saved audiences |
| POST | `/api/v1/admin/audiences` | signed | yes |  | Save an audience |
| PUT | `/api/v1/admin/audiences/{id}` | signed | yes |  | Change an audience |
| POST | `/api/v1/admin/audiences/{id}/count` | signed | yes |  | Count a saved audience again |

## `admin.content` Content and legal pages

Pages with drafts, second-person review, revisions and restore.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/content` | signed |  |  | Content and legal pages |
| POST | `/api/v1/admin/content` | signed | yes |  | Add a page |
| GET | `/api/v1/admin/content/{id}` | signed |  |  | One page |
| PUT | `/api/v1/admin/content/{id}` | signed | yes |  | Save a draft |
| POST | `/api/v1/admin/content/{id}/{action}` | signed | yes |  | Review, publish or discard a draft (second person) |
| GET | `/api/v1/admin/content/{id}/revisions` | signed |  |  | Revisions of a page |
| GET | `/api/v1/admin/content/{id}/revisions/{version}` | signed |  |  | One revision |
| POST | `/api/v1/admin/content/{id}/revisions/{version}/restore` | signed | yes |  | Restore a revision as a draft |

## `admin.data_requests` Data requests

Member access and deletion requests.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/data-requests` | signed |  | yes | Access and deletion requests |
| GET | `/api/v1/admin/data-requests/{id}` | signed |  | yes | One request |
| POST | `/api/v1/admin/data-requests/{id}/decision` | signed | yes | yes | Decide on a request |

## `admin.draws` Lucky draws

Draws, run and cancel.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/draws` | signed |  |  | Lucky draws |
| POST | `/api/v1/admin/draws` | signed | yes |  | Add a draw |
| POST | `/api/v1/admin/draws/{id}/run` | signed | yes |  | Run a draw |
| POST | `/api/v1/admin/draws/{id}/cancel` | signed | yes |  | Cancel a draw |

## `admin.engagement` Engagement studio

Tasks, ideas, stories and streaks.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/engagement/tasks` | signed |  |  | Tasks |
| POST | `/api/v1/admin/engagement/tasks` | signed | yes |  | Add a task |
| PUT | `/api/v1/admin/engagement/tasks/{id}` | signed | yes |  | Change a task |
| GET | `/api/v1/admin/engagement/ideas` | signed |  |  | Member ideas |
| POST | `/api/v1/admin/engagement/ideas/{id}` | signed | yes |  | Decide on an idea |
| GET | `/api/v1/admin/engagement/stories` | signed |  |  | Stories |
| POST | `/api/v1/admin/engagement/stories` | signed | yes |  | Add a story |
| PUT | `/api/v1/admin/engagement/stories/{id}` | signed | yes |  | Change a story |
| GET | `/api/v1/admin/engagement/streaks` | signed |  |  | Streak rules and counts |

## `admin.experts` Expert verification

Review B2B and HCP verification requests.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/experts` | signed |  | yes | Expert verification requests |
| GET | `/api/v1/admin/experts/{id}` | signed |  | yes | One request with its evidence |
| POST | `/api/v1/admin/experts/{id}/decision` | signed | yes | yes | Approve or decline with a reason |

## `admin.help` Help centre

Help articles per brand.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/help` | signed |  |  | Help articles |
| POST | `/api/v1/admin/help` | signed | yes |  | Add an article |
| PUT | `/api/v1/admin/help/{id}` | signed | yes |  | Change an article |
| POST | `/api/v1/admin/help/{id}/status` | signed | yes |  | Publish or unpublish an article |

## `admin.members` Member admin

Search, view and edit members, status, segment, ledger and unmasking with a reason.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/members` | signed |  | yes | Search members |
| GET | `/api/v1/admin/members/{id}` | signed |  | yes | One member (masked) |
| PUT | `/api/v1/admin/members/{id}` | signed | yes | yes | Change member fields |
| GET | `/api/v1/admin/members/{id}/ledger` | signed |  | yes | Points ledger of a member |
| POST | `/api/v1/admin/members/{id}/status` | signed | yes | yes | Set member status with a reason |
| POST | `/api/v1/admin/members/{id}/segment` | signed | yes | yes | Move a member to another segment |
| POST | `/api/v1/admin/members/{id}/unmask` | signed | yes | yes | Unmask contact details with a reason |

## `admin.members.actions` Member actions

Password reset and welcome e-mails, and “log in as member” with session tracking.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/members/{id}/reset-password` | signed | yes | yes | Send a password reset e-mail |
| POST | `/api/v1/admin/members/{id}/resend-welcome` | signed | yes | yes | Send the welcome e-mail again |
| POST | `/api/v1/admin/members/{id}/login-as` | signed | yes | yes | Start a “log in as member” session |
| GET | `/api/v1/admin/members/{id}/admin-sessions` | signed |  | yes | Admin sessions on this member |
| POST | `/api/v1/admin/members/{id}/admin-sessions/{sid}/end` | signed | yes | yes | End an admin session |

## `admin.members.archive` Six-month check and archive

Archive inactive members and restore them.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/members/archive-run` | signed | yes | yes | Six-month check: archive inactive members (dry run first) |
| POST | `/api/v1/admin/members/restore` | signed | yes | yes | Restore archived members |

## `admin.members.duplicates` Duplicate accounts

Find, merge (dry run first) and undo merges of duplicate accounts.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/members/duplicates` | signed |  | yes | Likely duplicate accounts |
| POST | `/api/v1/admin/members/merge` | signed | yes | yes | Merge accounts (dry run unless dryRun=0) |
| GET | `/api/v1/admin/members/merges` | signed |  | yes | Past merges |
| POST | `/api/v1/admin/members/merges/{id}/undo` | signed | yes | yes | Undo a merge |

## `admin.members.engagement` Member engagement view

What the member sees, survey history, alert channels and payout method.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/members/{id}/engagement` | signed |  | yes | What the member sees: streaks, alerts, payout method |
| GET | `/api/v1/admin/members/{id}/responses` | signed |  | yes | Survey participation of a member |
| PUT | `/api/v1/admin/members/{id}/alerts` | signed | yes | yes | Alert channels of a member |
| POST | `/api/v1/admin/members/{id}/payout/clear` | signed | yes | yes | Clear the saved payout method |

## `admin.messages` Portal messages

Messages shown in the member portal.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/messages` | signed |  |  | Portal messages |
| POST | `/api/v1/admin/messages` | signed | yes |  | Draft a message |
| GET | `/api/v1/admin/messages/{id}` | signed |  |  | One message |
| PUT | `/api/v1/admin/messages/{id}` | signed | yes |  | Change a draft |
| POST | `/api/v1/admin/messages/{id}/preview` | signed | yes |  | Count and preview before sending |
| POST | `/api/v1/admin/messages/{id}/send` | signed | yes |  | Send a message |
| POST | `/api/v1/admin/messages/{id}/withdraw` | signed | yes |  | Withdraw a message |

## `admin.offers` Offers

Bonus offers and ending them.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/offers` | signed |  |  | Offers |
| POST | `/api/v1/admin/offers` | signed | yes |  | Add an offer |
| POST | `/api/v1/admin/offers/{id}/end` | signed | yes |  | End an offer |

## `admin.points` Points

Point adjustments with four-eyes approval, and holds.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/members/{id}/points` | signed | yes | yes | Add or remove points (four eyes above the limit) |
| GET | `/api/v1/admin/points/approvals` | signed |  | yes | Point changes waiting for a second admin |
| POST | `/api/v1/admin/points/approvals/{id}` | signed | yes | yes | Approve or reject a point change |
| GET | `/api/v1/admin/points/holds` | signed |  | yes | Points on hold |
| POST | `/api/v1/admin/points/holds` | signed | yes | yes | Put points on hold |
| POST | `/api/v1/admin/points/holds/{id}/release` | signed | yes | yes | Release a hold |

## `admin.prize_machines` Prize machines

One prize machine per segment.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/prize-machines` | signed |  |  | Prize machines per segment |
| PUT | `/api/v1/admin/prize-machines/{segment}` | signed | yes |  | Set the machine of a segment |
| GET | `/api/v1/admin/prize-machines/{segment}/plays` | signed |  |  | Plays of a machine |

## `admin.profiles` Profiles

Profile questionnaires and completion rates.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/profiles` | signed |  |  | Profile questionnaires |
| GET | `/api/v1/admin/profiles/completion` | signed |  |  | Completion per profile |
| PUT | `/api/v1/admin/profiles/{id}` | signed | yes |  | Change a profile |

## `admin.quality` Quality and referral checks

Quality tiers, review queue, per-member quality and referral fraud.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/members/{id}/quality` | signed |  | yes | Quality history of a member |
| POST | `/api/v1/admin/members/{id}/quality` | signed | yes | yes | Set a quality decision |
| GET | `/api/v1/admin/quality/tiers` | signed |  | yes | Members per quality tier |
| GET | `/api/v1/admin/quality/review` | signed |  | yes | Members to review |
| GET | `/api/v1/admin/referrals/fraud` | signed |  | yes | Suspicious referral chains |

## `admin.question_bank` Question bank

Questions, options, translations, rules, Excel import and export, and versions with review.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/qb/export` | signed |  |  | Export the question bank |
| POST | `/api/v1/admin/qb/import` | signed | yes |  | Import questions (dry run first) |
| GET | `/api/v1/admin/qb/rules/check` | signed |  |  | Check the skip and show rules |
| GET | `/api/v1/admin/questions` | signed |  |  | Question bank list |
| POST | `/api/v1/admin/questions` | signed | yes |  | Add a question |
| GET | `/api/v1/admin/questions/{name}` | signed |  |  | One question |
| PUT | `/api/v1/admin/questions/{name}` | signed | yes |  | Change a question |
| PUT | `/api/v1/admin/questions/{name}/options` | signed | yes |  | Replace the options of a question |
| PUT | `/api/v1/admin/questions/{name}/translations` | signed | yes |  | Translations of a question |
| GET | `/api/v1/admin/qb/translations/missing` | signed |  |  | Questions missing a translation |
| GET | `/api/v1/admin/qb/versions` | signed |  |  | Question bank versions |
| POST | `/api/v1/admin/qb/versions` | signed | yes |  | Start a new version |
| GET | `/api/v1/admin/qb/versions/{n}` | signed |  |  | One version with its changes |
| POST | `/api/v1/admin/qb/versions/{n}/{action}` | signed | yes |  | Review, publish or discard a version (second person) |

## `admin.reminders` Auto reminders and channels

Rule-based reminders and the WhatsApp and SMS provider settings.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/reminders` | signed |  |  | Reminder rules |
| PUT | `/api/v1/admin/reminders` | signed | yes |  | Change reminder rules |
| POST | `/api/v1/admin/reminders/preview` | signed | yes |  | Who would get a reminder now (nothing sent) |
| GET | `/api/v1/admin/channels` | signed |  |  | WhatsApp and SMS providers (secrets never returned) |
| PUT | `/api/v1/admin/channels/{channel}` | signed | yes |  | Set a provider |
| POST | `/api/v1/admin/channels/{channel}/check` | signed | yes |  | Check a provider |
| POST | `/api/v1/admin/channels/{channel}/remove` | signed | yes |  | Remove a provider |

## `admin.reports` Reports

Aggregate counts per brand. No personal data.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/reports/{name}` | signed |  |  | One aggregate report |

## `admin.rewards` Rewards and redemptions

Reward catalogue and the redemption queue.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/rewards/catalogue` | signed |  | yes | Reward catalogue |
| POST | `/api/v1/admin/rewards/catalogue` | signed | yes | yes | Add a reward |
| PUT | `/api/v1/admin/rewards/catalogue/{key}` | signed | yes | yes | Change a reward |
| GET | `/api/v1/admin/redemptions` | signed |  | yes | Redemption queue |
| GET | `/api/v1/admin/redemptions/{id}` | signed |  | yes | One redemption |
| POST | `/api/v1/admin/redemptions/{id}/decision` | signed | yes | yes | Approve or reject with a reason |

## `admin.segments` Segments

Panel segments such as consumer, B2B, teens, HCP.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/segments` | signed |  |  | Segments of the brand |
| PUT | `/api/v1/admin/segments/{name}` | signed | yes |  | Change a segment |

## `admin.surveys` Surveys

Surveys, feasibility, invitations, responses and reconciliation.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/surveys` | signed |  | yes | Surveys |
| POST | `/api/v1/admin/surveys` | signed | yes | yes | Add a survey |
| GET | `/api/v1/admin/surveys/{id}` | signed |  | yes | One survey |
| PUT | `/api/v1/admin/surveys/{id}` | signed | yes | yes | Change a survey |
| POST | `/api/v1/admin/surveys/{id}/status` | signed | yes | yes | Open, pause or close a survey |
| POST | `/api/v1/admin/surveys/{id}/feasibility` | signed | yes | yes | How many members fit |
| POST | `/api/v1/admin/surveys/{id}/invite` | signed | yes | yes | Invite members (dry run first) |
| GET | `/api/v1/admin/surveys/{id}/responses` | signed |  | yes | Responses of a survey |
| POST | `/api/v1/admin/surveys/{id}/reconcile` | signed | yes | yes | Reconcile completes with the client list |

## `admin.switches` Feature switches

Feature on/off per brand, segment and country.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/switches` | signed |  |  | Feature switches with their rules |
| PUT | `/api/v1/admin/switches/{key}` | signed | yes |  | Set a switch rule with a reason |

## `admin.teens` Teens and guardians

Teen registrations, guardian links, turning 18.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/teens` | signed |  | yes | Teen members |
| GET | `/api/v1/admin/teens/{id}` | signed |  | yes | One teen with guardian status |
| POST | `/api/v1/admin/teens/{id}/revoke-links` | signed | yes | yes | Revoke guardian links |
| POST | `/api/v1/admin/teens/{id}/graduate` | signed | yes | yes | Move a member who turned 18 to adult terms |
| POST | `/api/v1/admin/teens/{id}/close` | signed | yes | yes | Close when adult terms were not accepted in time |
| GET | `/api/v1/admin/teens/registrations` | signed |  | yes | Teen registration pipeline |
| POST | `/api/v1/admin/teens/registrations/{id}/{action}` | signed | yes | yes | Approve, cancel or renew a registration |

## `admin.tickets` Support tickets

Ticket desk with replies and notes.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/tickets` | signed |  | yes | Ticket desk |
| GET | `/api/v1/admin/tickets/{id}` | signed |  | yes | One ticket |
| PUT | `/api/v1/admin/tickets/{id}` | signed | yes | yes | Change a ticket |
| POST | `/api/v1/admin/tickets/{id}/reply` | signed | yes | yes | Reply or add an internal note |
| POST | `/api/v1/admin/tickets/{id}/status` | signed | yes | yes | Change ticket status |

## `answers.read` One member’s answers

A full answer import for named members.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/user/{id}/profile` | bearer |  | yes | One member’s answers keyed by question name |

## `changes.answers` Answer changes feed (core)

Automatic sync: answers changed since the last run.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/changes/answers` | bearer |  | yes | Answers changed since a cursor |

## `changes.deletions` Deletions feed (core)

Deleted members and reset answers, so MADP deletes them too.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/changes/deletions` | bearer |  | yes | Tombstones of deleted members and reset answers |

## `changes.members` Member changes feed (core)

Automatic sync: members changed since the last run.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/changes/members` | bearer |  | yes | Members changed since a cursor, including deactivated and soft-deleted |

## `changes.responses` Survey response changes feed

Survey outcomes for the loyalty mirror and survey reports.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/changes/responses` | bearer |  | yes | Survey responses changed since a cursor (no telemetry) |

## `changes.rewards` Reward changes feed

Points rows for MADP’s read-only loyalty mirror.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/changes/rewards` | bearer |  | yes | Reward rows changed since a cursor (no free-text remarks) |

## `contract.discovery` Contract discovery (core)

Tells MADP which contract version the panel speaks and which capabilities it offers.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/contract` | either |  |  | Contract version, brands and capabilities of this panel |

## `members.read` Member list (full import)

A full member import. Optional when the changes feeds are served.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/user` | bearer |  | yes | All members (admin token only). Full import |

## `options.read` Answer options (core)

The options of each question, for value mapping.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/option/{question}` | bearer |  |  | Options of one question |

## `questionnaires.read` Profile questionnaires (core)

Which questions belong to which profile, page by page.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/profile` | bearer |  |  | Profile questionnaires with their pages of question names |

## `questions.read` Question list (core)

The profile questions, so MADP can map them to its attribute registry.

| Method | Path | Auth | Writes | Personal | What it does |
|---|---|---|---|---|---|
| GET | `/api/v1/question` | bearer |  |  | All profile questions |
