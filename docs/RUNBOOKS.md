# MADP runbooks

These are the operating procedures for MADP. **Nothing here has been run against production.** MADP has no production
environment yet, and deploying needs Kunal's go-ahead (see `CLAUDE.md`). Each section says what was actually tested and
where.

All three panels (T2O, MFR, MHO) follow the same procedure in every section. Where a step names a panel, repeat it for
each panel.

## 1. Health and alerts

| Signal | Where | Alert when |
| --- | --- | --- |
| API health | `GET /api/v1/health` returns `{status, postgres, mongodb}` | `status` is not `ok` for 2 minutes |
| Sync freshness, per panel | Connectors & sync screen, `GET /api/v1/sync-status` | Last successful sync older than 3 × `SYNC_INTERVAL_MINUTES` (once sync is on) |
| Dead letters, per panel | `GET /api/v1/dead-letters` | Any new dead letter |
| Webhook failures, per panel | Webhook inbox (`webhook_inbox`, rows with an error after processing) | Any row still unprocessed or in error after 15 minutes |
| Privacy deadlines | Privacy requests screen, AI insights rule `privacy_overdue` | Any request past `due_at`, or due within 3 days and not started |
| Login throttling and refusals | Security audit screen (`audit_event`), Supply360 refusals | A spike of `auth.login` with outcome `denied`, or `service.rejected` |
| Error rate | Load-balancer or API logs (`x-request-id` on every response) | 5xx above 1% for 5 minutes |

`ops/load/load-test.mjs` gives the latency baseline for these alerts. See [PERFORMANCE.md](PERFORMANCE.md).

## 2. Deploy (not executed)

Ask Kunal first. Then:

1. Make sure `main` is green in CI: build, type check, unit, contract and integration tests.
2. Take a backup (section 3) and keep it until the deploy is confirmed healthy.
3. Load the secrets from the secrets manager, never from a file in the repository: `AUTH_JWT_SECRET`,
   `FIELD_ENCRYPTION_KEY(S)`, `PII_HASH_KEY`, `PANEL_ADMIN_API_SECRET`, `WEBHOOK_SECRETS_<PANEL>`, panel API tokens.
   Production must set `NODE_ENV=production`, `REQUIRE_MFA=true` and the real `ADMIN_ORIGIN`.
4. Leave `LIVE_SOURCE_APPROVED_PANELS` empty unless Kunal has approved live read-only access for that panel.
5. Run migrations: `pnpm db:migrate`. Migrations only add; an applied migration is never edited.
6. Start the API, then the admin app (`MADP_API_URL` pointing at the API).
7. Check `GET /api/v1/health` is `ok`, sign in with MFA, open the dashboard, and confirm the DEMO banner shows only when
   data is DEMO.
8. Roll back: redeploy the previous build. Migrations are additive, so the previous build runs on the new schema. Restore
   the backup only if data was damaged.

## 3. Backup and restore

`ops/backup/restore-drill.sh <postgres-db> <mongo-db>` takes a `pg_dump` and a `mongodump`, restores both into fresh
databases named `<db>_restore_<stamp>`, compares the row count of every table and the document count of every collection,
and removes the restored copies.

**Drill evidence (2026-11-24, local, DEMO data):** run against `madp_preview_v2` (all three panels imported). 50 Postgres
tables and 4 Mongo collections matched exactly. The whole drill took about 11 seconds.

In production, run the drill monthly against the latest real backup in an isolated environment, and record the result
here. Backups hold encrypted personal fields; they stay encrypted at rest and are kept only as long as the retention
policy allows.

## 4. Key rotation

| Key | How to rotate | Effect |
| --- | --- | --- |
| `FIELD_ENCRYPTION_KEY(S)` | Add the new key as `kN=<base64>` in `FIELD_ENCRYPTION_KEYS`, set `FIELD_ENCRYPTION_ACTIVE_KEY=kN`, restart, then run `pnpm --filter @madp/api keys:rotate`. Check with `keys:rotate -- --status`, and remove the old key only when nothing is left on it. | Re-encrypts stored personal fields. No downtime. |
| `AUTH_JWT_SECRET` | Replace and restart. | Every admin is signed out and signs in again. |
| `WEBHOOK_SECRETS_<PANEL>` | Set two comma-separated secrets (old,new), switch the panel to the new one, then drop the old one. | No missed webhooks. |
| `PANEL_ADMIN_API_SECRET` | Change it in MADP and in the panel's `MADP_ADMIN_API_SECRETS` together. Needs approval, because it touches the panel. | Member and question bank screens pause until both match. |
| Supply360 service client | Create a new client in Supply360 console (`POST /api/v1/service-clients`), hand over the secret once, then revoke the old one (`POST /api/v1/service-clients/:id/revoke`). | Revoked clients are refused and the refusal is audited. |
| `PII_HASH_KEY` | Do not rotate in place: matching hashes depend on it. Plan a re-hash with a migration if it is ever exposed. | — |

## 5. Panel sync failure (per panel)

1. Open Connectors & sync. Find the panel whose last sync failed or is late.
2. Read the error and the dead letters for that panel. Common causes: an expired token, the panel API is down, or a
   changed field.
3. If the token expired, a new one is needed from the panel owner. Never paste tokens into chat; put them in the secrets
   manager.
4. Run a dry-run import for the panel first (`POST /api/v1/connectors/<panel>/import` with `dryRun: true`), then the real
   one. Sync resumes from its checkpoint, so nothing is imported twice.
5. A late panel never blocks the other two: counts stay per panel and are never added across panels.

## 6. Privacy request deadlines

1. Each request has a `due_at`. Overdue and due-soon requests show on the Privacy requests screen and as a critical AI
   insight (`privacy_overdue`).
2. The privacy officer works the steps in order. Deletion needs a second person (four-eyes).
3. If a deadline cannot be met, record the reason on the request and tell the data subject through the panel's normal
   support channel (with approval; MADP sends no messages itself).
4. Retention periods still need counsel's sign-off. Until then, the purge job only removes technical records
   (idempotency keys after 30 days, dry-run communication events after 180 days).

## 7. Security incident

1. Contain: revoke the affected Supply360 clients, rotate `AUTH_JWT_SECRET` to sign everyone out, and disable affected
   admins.
2. Preserve: export the security audit for the window, and keep a backup.
3. Assess: which panels and how many people. MHO data is special-category, so treat any MHO exposure as high severity.
4. Tell Kunal at once. He decides on notifying regulators and members; MADP does not send messages on its own.
5. Afterwards, record what happened and what changed here.

## What was tested

- `apps/api/test/security.test.ts`: every route is either public by design or needs a session and a permission; no route
  answers without credentials; tampered, foreign, unsigned and expired tokens are refused; security headers; CORS allows
  only the admin origin; malformed input returns 400 or 413; login attempts are throttled.
- The backup and restore drill above.
- The load test in [PERFORMANCE.md](PERFORMANCE.md).
