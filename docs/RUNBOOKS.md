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
| Abuse blocks on signed public routes | Security audit screen, `service.rejected` or `webhook.rejected` with `addressBlocked: true` | Any block. Check the address, and whether a real client lost its secret or its clock drifted |
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
4. Leave `LIVE_SOURCE_APPROVED_PANELS` empty unless Kunal has approved live read-only access for that panel. Panel
   addresses, tokens, the admin API secret, the sync interval and the live switch are normally set on the console's
   **Panel connections** screen instead (Super Admin, authenticator code, four eyes when a second Super Admin exists).
   Values saved there win over the environment; environment values stay as a fallback.
5. Run migrations: `pnpm db:migrate` (on Swarm, each api replica does this as it starts). Migrations only add; an applied
   migration is never edited.
6. Start the API, then the admin app (`MADP_API_URL` pointing at the API).
7. Check `GET /api/v1/health` is `ok`, sign in with MFA, open the dashboard, and confirm the DEMO banner shows only when
   data is DEMO.
8. Roll back: redeploy the previous build. Migrations are additive, so the previous build runs on the new schema. Restore
   the backup only if data was damaged.

### Docker Swarm (Kunal's hosting)

MADP runs only in containers, from `ops/deploy/madp-stack.yml`. What the stack keeps to:

- **No published ports.** Only the proxy manager in front (Traefik or Nginx Proxy Manager) publishes 80 and 443.
  Docker writes its own iptables rules, so a port published by any container would bypass UFW. Leave `ports:` out of
  every MADP service.
- **Two networks.** Only the nginx gateway joins the external network `publicweb`, under the alias `madp-gateway`.
  Everything else (api, admin, postgres, mongodb, the migration job) is on the overlay network `madp`, encrypted
  between nodes. Postgres and MongoDB are never on `publicweb`.
- **TLS stays in front.** The gateway listens on plain 80. The proxy manager terminates TLS, redirects http to https and
  forwards `MADP_HOST` to `http://madp-gateway:80`. The gateway sends `/api/` to the API and everything else to the
  console, and drops requests for any other host name.
- **Secrets are Swarm secrets.** The API reads `X_FILE=/run/secrets/...` for each secret (`withSecretFiles` in
  `packages/config`). Setting both `X` and `X_FILE` is refused.

First deploy, on a manager node:

1. Create the network once if it doesn't exist: `docker network create -d overlay --attachable publicweb`.
2. Label the node that keeps the database volumes: `docker node update --label-add madp.db=true <node>`.
3. Create the secrets (each value generated fresh, never typed into a file in the repository):

   ```
   openssl rand -hex 32 | docker secret create madp_postgres_password -
   openssl rand -hex 32 | docker secret create madp_mongodb_password -
   printf 'postgres://madp:%s@postgres:5432/madp' "<postgres password>" | docker secret create madp_database_url -
   printf 'mongodb://madp:%s@mongodb:27017/?authSource=admin' "<mongodb password>" | docker secret create madp_mongodb_url -
   openssl rand -hex 32    | docker secret create madp_auth_jwt_secret -
   openssl rand -base64 32 | docker secret create madp_field_encryption_key -
   openssl rand -hex 32    | docker secret create madp_pii_hash_key -
   printf '%s' "<the same value as the panel backend's MADP_ADMIN_API_SECRETS>" | docker secret create madp_panel_admin_api_secret -
   ```

   Back up `madp_field_encryption_key` and `madp_pii_hash_key` apart from the database: losing either loses or unlinks
   personal data.
4. Build and push the images from a green `main`, with the stack file itself (it has `build:` for api and admin):

   ```
   export MADP_HOST=<host> MADP_REGISTRY=<registry> MADP_VERSION=<version>
   docker compose -f ops/deploy/madp-stack.yml build
   docker compose -f ops/deploy/madp-stack.yml push api admin
   ```

   This tags `<registry>/api:<version>` and `<registry>/admin:<version>`. `docker stack deploy` ignores `build:` and
   pulls these images from the registry on each node.
5. Deploy: `MADP_HOST=<host> MADP_REGISTRY=<registry> MADP_VERSION=<version> docker stack deploy -c
   ops/deploy/madp-stack.yml madp`. Each api replica applies pending migrations before it listens. It waits up
   to two minutes for Postgres, and an advisory lock makes replicas that start together migrate only once (issue #67).
   Check it with `docker service logs madp_api`: each replica prints `Migrations applied` before `MADP API listening`.
6. Create the first admin: `docker exec -it $(docker ps -q -f name=madp_api | head -1) node dist/scripts/create-admin.js
   --email <e-mail> --name <name> --role super_admin`, with `MADP_ADMIN_PASSWORD` set for that one command. It
   applies any pending migrations first, so it also works on a database nothing has migrated yet.
7. Add MADP to the proxy manager (below), then check `https://<host>/api/v1/health` and sign in with MFA.
8. Connect the panels on **Panel connections**: for each brand enter the sync address and token, press *Test
   connection*, enter the admin API address and secret, and turn on live sync when Kunal approves it. No restart is
   needed; the sync schedule picks up the change within a minute.
9. **Add a panel** (a new brand on the shared panel backend): a Super Admin on every brand opens **Panels**, presses
   *Add a panel*, and enters a code, names, the site hostnames and a reason. The panel starts on DEMO. Then connect it
   on **Panel connections** (step 8). On the shared panel backend, add the new site's hostname to
   `MADP_ADMIN_API_ORIGINS` at its next deploy, or the backend refuses MADP's admin calls for that brand. Grants with
   *all brands* cover the new panel at once; admins limited to some brands get it only when it is added to their
   grant. On a panel marked sensitive, an all-brands grant opens no health data (Super Admin excepted): give the role
   with the panel ticked by name. Archive stops the panel's sync and hides it; Restore brings it back. Delete works only while the panel
   holds no data. The three built-in panels can't be archived or deleted, and MHO always stays sensitive.
10. **Audience segments** (Consumers, Business Professionals, Healthcare Professionals, Patients, Caregivers, Teens
   and any added later): a Super Admin on every brand adds, renames, archives, restores or deletes them on **Audience
   segments**. A rule there links a panel's own category value (for example `b2c` on MFR) to a segment; sync applies
   the active rules to new and updated members. A minor joins the adult segment and Teens. Archiving a segment hides
   it from filters and stops new members joining; a segment with members can't be deleted, only archived.

Each later release: steps 4 and 5 with the new version. Swarm replaces the api and admin replicas (each new api
replica migrates first) one at a time, starting the new one first and rolling back if it fails. A stack deployed
before issue #67 still has the old `madp_migrate` job: remove it once with `docker service rm madp_migrate` (or deploy
with `--prune`).

Mail: MADP itself sends no e-mail today (panel campaigns are sent by the panel backend). When sending is approved,
the SMTP details go in as Swarm secrets in the same way.

**Traefik with static file routing.** Add to a file in Traefik's dynamic configuration directory:

```yaml
http:
  routers:
    madp:
      rule: Host(`<MADP_HOST>`)
      entryPoints: [websecure]
      service: madp
      tls: {}            # or certResolver: <your resolver>
  services:
    madp:
      loadBalancer:
        servers:
          - url: http://madp-gateway:80
```

Traefik must itself be attached to `publicweb` to reach `madp-gateway`.

**Nginx Proxy Manager.** Add a proxy host:

- Domain names: `<MADP_HOST>`
- Scheme `http`, forward hostname `madp-gateway`, forward port `80`
- Websockets support: on. Block common exploits: on.
- SSL tab: request or pick the certificate, then turn on Force SSL and HTTP/2.

The NPM container must be attached to `publicweb`.

**Tested (2026-11-25, local single-node swarm, throwaway secrets):** the images were built from this branch and the
stack was deployed. The migration job finished, and both api and both admin replicas came up healthy. From a container
on `publicweb`, `madp-gateway` answered `/api/v1/health` (200), the console sign-in page (200) and `/` (307 to sign-in).
Another host name got no answer, and `madp_api` couldn't be reached from `publicweb`. No service published a port. The
sandbox kernel has no IPVS, so that test used `endpoint_mode: dnsrr` and an unencrypted overlay. A normal Docker host
doesn't need either change.

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
