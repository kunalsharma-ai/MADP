# Repository audit: MyFrequentRewards (MFR)

- **Repository:** github.com/kunalsharma-ai/MFR (public), audited read-only at commit `496fc6f` on 2026-11-23.
- **Method:** source reading only; no production access. Legend as in the T2O audit.

## 1. Runtime and stack
| Area | Finding |
|---|---|
| Backend | `Project/api` — same ancestor as T2O (Express 4.19, Mongoose 8.5, JWT, bcryptjs, `express-web-tools`), package `mfr-api`. `npm start` runs `npm install` first. ⚠️ `package.json` has a missing comma after `test:engagement`, so the file is **invalid JSON** as committed; `npm` will refuse it until fixed. |
| Tenancy | ✅ same `origin = Host` model (`utils/setOrigin.js`). |
| Frontends | `Project/web` (Next.js 15.5, React 19.1, admin pages), `Project/frontend-1` (Vite 6.4, React 18.3.1 site + member area), `Project/account-actions-src`. |
| Services | `Project/services/{gateway,email,captcha,storage}` configs. |
| Engagement | `app/engagement/*` — points ledger, streaks, referrals, prize draws, quality score, teen flows, lifecycle e-mails, weekly summaries, expiry reminders; cron scripts in `app/jobs/*` (hourly lifecycle, daily birthday at 09:00 UTC, weekly summary, points expiry, teen reminders). |
| Tests | `tests/engagement.*.test.mjs`, `tests/teen.*`, `tests/support.access.test.mjs` with a test harness — the best-tested of the three repos. |

## 2. Identity
- ✅ `User` model close to T2O's with differences: `qualityScore` max 200; `name.last` required unless the category contains `minor`; phone required to validate when present (`if (!v) return false` — empty phone fails validation); `role` enum excludes `admin`; guardian `relation` uses `legal_guardian`. Teen registration moved to `/api/v1/teen` with dedicated models `TeenRegistration`, `TeenGuardian`, `TeenConsent`, `TeenToken`, `GuardianLink`.
- ✅ Unique `{mail, origin}`.

## 3. Questionnaires and answers
- ✅ Same `Profile` / `Question` / `Option` / `Answer` models as T2O (minor differences: no `icon`, `maxSelections` absent in `Question`). DB-driven.
- ❌ **No questionnaire export in the repository.** Question definitions live only in the MFR database. MADP's MFR fixture therefore uses synthetic placeholder definitions built around the question *names* the MFR frontend writes to (`frontend-1/src/utils/profileAnswers.js`, `src/data/worldQuestions.js`): `empstat, hw, freelancer, jobseeker, industry, sector, department, jobrole, workemail, interests/hobbies, communication-methods, terms-consent, news-letter`. Labels/options are clearly marked `[placeholder]`.
- ⚠️ Marketing and terms consent are stored **as answers** (`terms-consent`, `news-letter`), alongside `User.consent` and the separate `MemberPreference` collection.

## 4. Consent, preferences, deletion
- ✅ `MemberPreference`: per-member notification switches (email, push, whatsapp, weeklySummary, expiryReminders, newSurvey, lifecycle, birthday), quiet hours, invites-per-week cap, topics, best times. This is the richest preference model of the three and maps well to MADP's preference centre.
- ✅ `DataRequest` (kind `delete`, status requested/approved/rejected/done/cancelled, history). Deletions are carried out by hand; nothing emits an event.
- ✅ One-click unsubscribe links are HMACs of (member, list) (`engagement/mail.js`).

## 5. Rewards
- ✅ `engagement/ledger.js` derives a ledger from `Response(status complete)` + `Reward` (unique `{user,key,origin}` so grants are idempotent) + extra sources (redemptions) with states cleared / pending (hold days) / on_hold (`PointsHold`). Balances are computed, not stored. Also `Redemption`, `CatalogueItem`, `BonusOffer`, `PrizeDraw`, `DrawEntry`, `StreakDay`, `Task`, `TaskEntry`.
- MADP must keep MFR points separate and read-only (spec §10).

## 6. API surface relevant to MADP
| Need | Endpoint | Auth (verified in `utils/access.js`) |
|---|---|---|
| Questionnaires | `GET /api/v1/profile` | none |
| Questions / options | `GET /api/v1/question`, `GET /api/v1/option/:q` | none |
| Respondents | `POST /api/v1/user` | `requireAdmin` (role re-read from DB), body passed through `safeFilter()`; unpaginated |
| Summary | `GET /api/v1/user/summarize` | `requireAdmin` |
| Answers | `POST /api/v1/user/:user/profile-data` `{questions:[...]}` | `selfOrAdmin` — returns only the listed questions |
| Service accounts | — | ❌ none; an integration would need a member account with an admin role and a 7-day JWT |
| Webhooks | — | ❌ |

## 7. Security findings
Security findings from this audit are kept in a private document shared with the panel owner, not in this public repository. They are summarised by severity in `SECURITY_PRIVACY.md` §5.
