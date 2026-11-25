# Go-live checklist: MADP and the three panels

One list of everything Kunal has to provide, set or approve to put MADP and the T2O, MFR and MHO backends live
together. **Nothing here has been done.** Every step needs Kunal's go-ahead (see `CLAUDE.md`). Read from each repo's
default branch on 2026-11-24. T2O-specific detail is in [T2O_GO_LIVE.md](T2O_GO_LIVE.md), and the deploy, backup and
key rotation steps are in [RUNBOOKS.md](RUNBOOKS.md).

Secrets go into the secrets manager of each environment. Never into chat, a repository or a ticket.

## 1. Decisions only Kunal can make

| Decision | Why it blocks |
| --- | --- |
| MADP's public address (`MADP_HOST`) and which proxy manager fronts it | Hosting is decided: Docker Swarm, nginx gateway on `publicweb`, UFW, no published ports (`ops/deploy/madp-stack.yml`, RUNBOOKS section 2). The host name sets `ADMIN_ORIGIN` and the proxy route |
| Approve live read-only access, one panel at a time | `LIVE_SOURCE_APPROVED_PANELS` stays empty until then; every screen shows DEMO data |
| Which backend MHO production runs, and the production host of each panel | The connectors and the signed admin API need the real addresses |
| Confirm the shared backend | The console's signed admin API (`/api/admin/v1`) is on MFR `main` (MFR#44 onwards) and serves every brand by `x-madp-origin`, because the three brands share one panel backend and database. T2O `Main` and MHO `Main` do not carry it, by design. If MHO production turns out to run a separate backend, it needs its own copy |
| An e-mail provider, and approval to send | Every panel job and MADP campaign writes to an outbox folder or stays a dry run. Nothing is sent today |
| Deploy-time protection: WAF and load balancer rate limits, GitHub secret scanning and CodeQL | Not settable from the code |

### Brand details to enter in Brands & settings

Mail footers and consent screens read these from Brands & settings (`brand_setting`). The code holds none of them, so
an admin with `brands.manage` enters them once per brand after go-live. Until then, mail previews show "[privacy
policy link not set]".

| Brand | Sender | Privacy policy |
| --- | --- | --- |
| T2O | support@turn2opinion.com | https://www.turn2opinion.com/privacy/ |
| MFR | support@myfrequentrewards.com | https://www.myfrequentrewards.com/privacy |
| MHO | support@myhealthopinions.com | https://www.myhealthopinions.com/privacy/ (given by Kunal on 2026-11-25) |

The legal footer is the same for all three: FREQUENT RESEARCH FIELDWORK SOLUTIONS PRIVATE LIMITED, 70/1/2 Mangolpur
Kalan, First Floor, West Enclave, Pitampura, Delhi 110085.

## 2. MADP API (`apps/api`)

Generate each secret fresh for each environment. Production must not reuse a development value.

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `PORT` | e.g. `4000` | |
| `DATABASE_URL` | Postgres 18 URL | Run `pnpm db:migrate` on every deploy |
| `MONGODB_URL`, `MONGODB_DB` | MongoDB 8 | |
| `AUTH_JWT_SECRET` | secret, `openssl rand -hex 32` | Rotating it signs every admin out |
| `FIELD_ENCRYPTION_KEY` | secret, `openssl rand -base64 32` | Encrypts personal fields. Losing it loses that data. Back it up apart from the database |
| `FIELD_ENCRYPTION_KEYS`, `FIELD_ENCRYPTION_ACTIVE_KEY` | empty and `k1` at first | Only for rotation (RUNBOOKS section 4) |
| `PII_HASH_KEY` | secret, `openssl rand -hex 32` | Never change it after go-live: it links the same person across panels |
| `REQUIRE_MFA` | `true` | |
| `AUTH_TOKEN_TTL_MINUTES`, `ADMIN_IDLE_MINUTES` | defaults 60 and 30 | |
| `ADMIN_ORIGIN` | the admin app's https address | CORS and cookies |
| `RATE_LIMIT_PER_MINUTE` | default 300 | Raise only in a load test environment |
| `ABUSE_MAX_FAILURES` | default 20 | Blocks an address after this many bad signatures |
| `MIN_CELL_SIZE`, `SENSITIVE_MIN_CELL_SIZE` | defaults 5 and 10 | Small-cell suppression; health filters use the larger one |
| `OPENAPI_PUBLIC` | leave off in production | |
| `LIVE_SOURCE_APPROVED_PANELS` | empty, then `t2o`, `mfr`, `mho` one by one | Only after Kunal approves each panel |
| `T2O_API_BASE_URL`, `T2O_API_TOKEN` (and `MFR_`, `MHO_`) | panel URL and a dedicated MADP admin token | Read-only connector. Not a member account |
| `PANEL_ADMIN_API_SECRET` | secret, `openssl rand -hex 32` | The same value goes into each panel's `MADP_ADMIN_API_SECRETS` |
| `T2O_ADMIN_API_BASE_URL`, `MFR_ADMIN_API_BASE_URL`, `MHO_ADMIN_API_BASE_URL` | all three: the MFR backend's address | One admin API serves all three brands. Empty turns that brand's console screens off |
| `SYNC_INTERVAL_MINUTES`, `SYNC_MAX_PAGES` | `0` until the first full import, then `5`; default 100 | |
| `WEBHOOK_SECRETS_T2O`, `_MFR`, `_MHO` | one or two secrets of 32 or more characters | Two at once allows rotation. Empty turns that panel's webhooks off |
| `WEBHOOK_TOLERANCE_SECONDS` | default 300 | |
| `DEMO_POPULATION_SIZE` | not used in production | DEMO fixtures only |

## 3. MADP admin app (`apps/admin`)

| Variable | Value |
| --- | --- |
| `MADP_API_URL` | the API's address, ending `/api/v1` |
| `NODE_ENV` | `production` (build with it too: `NODE_ENV=production next build`) |

The admin app sets a nonce-based Content-Security-Policy itself (`src/proxy.ts`). Serve it over https only.

## 4. Each panel backend (T2O, MFR, MHO)

Names are from each repo's default branch. The `MADP_ADMIN_API_*` pair is set once, on the MFR backend that serves the
admin API for all three brands.

| Variable | T2O | MFR | MHO | Notes |
| --- | --- | --- | --- | --- |
| `MONGO_URL`, `JWT_SECRET`, `NODE_ENV=production` | yes | yes | yes | |
| `SOCIAL_JWT_SECRET` | yes | yes | yes | Social sign-on is switched off in configuration today |
| `MADP_ADMIN_API_SECRETS` | | yes | | The `PANEL_ADMIN_API_SECRET` value. Empty = the admin API answers 404 to everything |
| `MADP_ADMIN_API_ORIGINS` | | yes | | All three hosts: `www.turn2opinion.com,www.myfrequentrewards.com,www.myhealthopinions.com`. A brand left out is refused |
| `CAPTCHA_REQUIRED` | `true` | `true` | `true` | Refuses sign-up and login without the human check |
| `TURNSTILE_SECRET` | | | yes | MHO's human check secret |
| Link signing secret | `LINK_SECRET` | `ENGAGEMENT_LINK_SECRET` | | **Set it.** Without it the code falls back to `JWT_SECRET` or a fixed word |
| `TOKEN_PEPPER` | | | yes | **Set it.** Without it the code falls back to `JWT_SECRET` |
| Teen job key | `TEEN_CRON_KEY` | `TEEN_JOB_KEY` | | Protects the teen reminder and expiry sweep route |
| `ENGAGEMENT_CONFIG` | | yes | | File that switches each e-mail job on. Leave jobs off until sending is approved |
| `email_admin_actions` switch | | yes | | Console e-mails to one member (reset link, welcome again). Off by default; turn on per brand only after sending is approved |
| `TEEN_MAIL_OUTBOX`, `ENGAGEMENT_MAIL_OUTBOX` | | yes | | Folder the jobs write e-mails to instead of sending |
| `PUBLIC_SITE_URL` | | yes | | Links in e-mails. Defaults to `https://<origin>` |
| `SUPPORT_TEAM_EMAIL` | yes | | | Support desk addresses |
| `MHO_TERMS_VERSION_PATIENT`, `_HCP`, `_CAREGIVER` | | | yes | Current terms version per MHO member type |
| `MAIL_MX_CHECK`, `MHO_RATE_LIMIT_SCALE` | | | yes | Leave unset in production. They are for test runs only |

Front ends (public values only, visible in the browser): `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (MFR web, restricted to the
brand's domains), `VITE_SITE_URL`, `VITE_API_BASE_URL` and `VITE_MEMBER_PORTAL_URL` (MFR site), and the matching
`VITE_*` and `SITE_URL` values for T2O and MHO.

The T2O consent kits (`Project/frontend-1/consent-kits`) fall back to `change-me` for `HASH_SALT` and `IP_SALT`. Set
both if those servers are deployed.

## 5. Scheduled jobs

| Job | Where | Schedule | State at go-live |
| --- | --- | --- | --- |
| Panel sync | MADP API, in process | every `SYNC_INTERVAL_MINUTES` | Off until the first full import is checked |
| Backup and restore drill | `ops/backup/restore-drill.sh` | backups daily, drill monthly | Set up with the database host |
| Key rotation status | `pnpm --filter @madp/api keys:rotate -- --status` | after each rotation | |
| Teen reminders and expiry | MFR `app/jobs/teen-reminders.js` or `POST /api/v1/teen/jobs/sweep` with the job key; T2O uses `TEEN_CRON_KEY` | hourly (`7 * * * *`) | Sends e-mail: needs approval |
| Lifecycle e-mails and birthdays | MFR `app/jobs/lifecycle-emails.js` | hourly (`23 * * * *`) | Off in `ENGAGEMENT_CONFIG` |
| Weekly points recap | MFR `app/jobs/weekly-summary.js` | Mondays 09:15 | Off in `ENGAGEMENT_CONFIG` |
| Points expiry reminders | MFR `app/jobs/points-expiry-reminders.js` | daily | Off: there is no points expiry |
| Feature switch index | MFR `app/jobs/feature-switch-index.js` | once per database, at deploy | Run with `--dry-run` first |
| Panel database setup | T2O `scripts/golive-setup.js --origin <host>` | once per panel | Dry run first, then `--apply` |

## 6. Order on the day

1. Kunal approves the deploy and names the hosts.
2. Generate the secrets in section 2 and section 4 in the secrets manager.
3. Deploy the panel backends, then run the one-off setup jobs in section 5 with dry runs first.
4. Deploy MADP: take a backup, run `pnpm db:migrate`, start the API, then the admin app (RUNBOOKS section 2).
5. Create the first super admin (`pnpm --filter @madp/api admin:create`) and enrol MFA.
6. Check `GET /api/v1/health`, sign in, and confirm the DEMO banner shows while no panel is live.
7. For each panel Kunal approves: set its token, add it to `LIVE_SOURCE_APPROVED_PANELS`, run a dry run from the
   Connectors screen, share the counts, run the full import, then turn on sync.
8. Turn on the e-mail jobs only after a provider is set up and Kunal approves sending.
