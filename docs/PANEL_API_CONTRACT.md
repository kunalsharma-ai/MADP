# MADP Panel API Contract, version 1.0.0

**Simple words mein:** MADP ab kisi ek panel ke code se bandha nahi hai. Ek common API Contract hai. Koi bhi panel
(T2O, MFR, MHO, ya kal ka koi naya panel ya panel network) agar is contract ke routes, shapes aur signing follow karta
hai, to woh MADP ke saath kaam karega. Panel `GET /api/v1/contract` par batata hai ki woh contract ka kaunsa version
bolta hai aur kaun kaun se features (capabilities) deta hai. MADP sirf wahi features call karta hai. Contract T2O ke API
style par bana hai: wahi `/api/v1` routes, wahi `{status, message, data}` envelope, wahi bearer token.

| | |
|---|---|
| Source of truth | `packages/panel-contract/src` (`operations.ts`, `records.ts`, `capabilities.ts`, `discovery.ts`, `signing.ts`) |
| OpenAPI 3.1 | [`docs/panel-contract/openapi.v1.json`](panel-contract/openapi.v1.json) (generated, checked by a test) |
| Every route | [`docs/panel-contract/ROUTES.md`](panel-contract/ROUTES.md) (generated, checked by a test) |
| Conformance kit | `packages/panel-contract/bin/conformance.mjs`, and **Run conformance** on Panel connections |
| Reference panel | `createReferencePanel()` in `packages/panel-contract/src/reference-panel.ts` (DEMO data only) |

## 1. Why

Until now MADP's panel routes were written for one codebase: the T2O backend that T2O, MFR and MHO all run (read and
sync routes, `kunalsharma-ai/turn2opinion` `Project/backend`) and the shared admin API whose code lives in the MFR
repository (`kunalsharma-ai/MFR` `Project/api/app/admin`). A new panel or network could only join by running that exact code. The owner
asked for one contract instead (2026-11-27), and for it to follow T2O's API concepts as far as possible.

So the contract **is** the T2O backend's API, written down, versioned and testable, plus one new route (discovery):

- Routes under `/api/v1`, with T2O's names: `/question`, `/option/{question}`, `/profile`, `/user`,
  `/user/{id}/profile`, `/changes/*`, `/admin/*`.
- The T2O envelope on every answer: `{status: 'success', message?, data}` or `{status: 'error', message, code?}`.
- A bearer token for the read and sync routes (T2O's integration account), and the signed `x-madp-*` headers already
  used by the shared backend's `/api/v1/admin`.
- The T2O record shapes (Question, Option, Profile, User, Answer, Tombstone, Rewards, Response). Panels may send more
  fields; MADP ignores what it does not know.

Nothing changes for the three existing panels: those two backends already serve every route except discovery, and
until they serve discovery MADP assumes their capabilities (section 9). The read and sync routes and the admin API may
run on different hosts; each declares what it serves, and together they must cover the core capabilities.

## 2. Inventory: what MADP calls today

Taken from the code on 2026-11-27 and pinned by tests, so it cannot drift:

- **11 read and sync routes** (`packages/connectors/src/http-connector.ts`, `PanelApiConnector`): contract discovery,
  questions, options, profiles, full member list, one member's answers, and five changes feeds (members, answers,
  deletions, rewards, responses).
- **117 signed admin resources, 138 method + path operations** (`PANEL_ADMIN_ROUTES`), called from 15 files in
  `apps/api/src` (members, duplicates, bulk actions, notes, question bank, questionnaires, content, support, rewards,
  engagement, reminders, reports, activity, fraud alerts, automations).
- **149 operations in total**, in 40 capabilities. The full list is [ROUTES.md](panel-contract/ROUTES.md).

`packages/connectors/src/contract.test.ts` scans every `'METHOD', R.route` call in `apps/api/src` and fails if one is
not a method and route of the contract. `PANEL_ADMIN_ROUTES` has exactly one helper per contract resource and builds
its paths from the contract, so a route can only be added in `operations.ts`.

## 3. Base URL, envelope and errors

The panel gives MADP one base URL (Panel connections). For the read and sync routes MADP calls the brand's own hostname,
because the T2O backend takes its tenant from the Host header. For admin routes the brand is the signed
`x-madp-origin` header, never the Host header.

| HTTP | When | MADP does |
|---|---|---|
| 200 + `status: 'success'` | OK | uses `data` |
| 400, 422 | bad input (`code` e.g. `reason_required`) | shows the message |
| 401, 403 | credential missing, wrong, stale or replayed | stops, never retries, shows "the panel refused MADP's credential" |
| 404 | not found, **or the capability is not offered** | for a feed: "not supported yet"; otherwise not found |
| 409 | conflict (already decided, already running) | shows the message |
| 408, 425, 429, 5xx | temporary | retries with backoff, honours `Retry-After` (max 60 s) |
| 3xx | never allowed | MADP refuses to follow it, so a token or signature never goes to another host |

MADP sends `x-madp-contract-version: 1.0.0` on every call. A panel may log it or ignore it.

## 4. Authentication

**Read and sync routes:** `Authorization: Bearer <token>`. The token belongs to an integration account that only reads.
`GET /api/v1/user` and the changes feeds must refuse a non-admin token with 403, not answer an empty list, so a wrong
token fails loudly.

**Signed admin routes** (`/api/v1/admin/*`), unchanged from the shared backend (MFR#44, MFR#62):

| Header | Value |
|---|---|
| `x-madp-timestamp` | Unix seconds. Refused when more than 300 s from the panel's clock |
| `x-madp-nonce` | 32 to 64 hex characters, new per call. Each nonce is accepted once (remember them 10 minutes) |
| `x-madp-origin` | The brand hostname. Every query filters on it |
| `x-madp-actor` | The MADP admin's id (a UUID), for the panel's own log |
| `x-madp-signature` | hex HMAC-SHA256 with the shared secret of the canonical string below |

```
${timestamp}\n${nonce}\n${METHOD}\n${path + query}\n${origin}\n${actor}\n${sha256 hex of the raw body}
```

`sign()` and `verifySigned()` in `signing.ts` are the reference (same as `app/admin/auth.js` in the MFR repository).
Answers, all `{status:'error', code:'admin_auth', message}`: 401 for a missing, wrong or stale signature, 403 for a brand
the backend does not serve (the shared backend's `MADP_ADMIN_API_ORIGINS`), 409 for a replayed nonce.

`GET /api/v1/contract` accepts either credential.

## 5. Discovery: `GET /api/v1/contract`

```json
{
  "status": "success",
  "data": {
    "contract": "madp-panel-api",
    "version": "1.0.0",
    "implementation": { "name": "t2o-shared-backend", "version": "2.4.0" },
    "brands": [{ "origin": "www.turn2opinion.com" }, { "origin": "www.myfrequentrewards.com" }],
    "capabilities": ["contract.discovery", "questions.read", "options.read", "questionnaires.read",
                     "changes.members", "changes.answers", "changes.deletions", "admin.members"],
    "limits": { "maxPageSize": 1000 },
    "webhooks": { "events": ["member.changed", "answers.changed"] }
  }
}
```

No personal data. MADP checks the shape, that the major version is one it speaks, and that every **core** capability is
declared. Unknown capability ids (from a newer minor version) are accepted and ignored.

## 6. Capabilities

**Core** (a panel needs all of them to connect): `contract.discovery`, `questions.read`, `options.read`,
`questionnaires.read`, `changes.members`, `changes.answers`, `changes.deletions`.

**Optional read and sync:** `members.read` and `answers.read` (full import), `changes.rewards`, `changes.responses`
(loyalty mirror), `special_category` (declares health answers, see section 8), `webhooks.push`.

**Optional admin** (the super admin console): `admin.members`, `admin.members.actions`, `admin.members.engagement`,
`admin.members.duplicates`, `admin.members.archive`, `admin.question_bank`, `admin.profiles`, `admin.segments`,
`admin.audiences`, `admin.surveys`, `admin.points`, `admin.quality`, `admin.experts`, `admin.tickets`,
`admin.messages`, `admin.help`, `admin.content`, `admin.switches`, `admin.reminders`, `admin.prize_machines`,
`admin.reports`, `admin.rewards`, `admin.draws`, `admin.offers`, `admin.engagement`, `admin.teens`,
`admin.data_requests`.

When a console screen needs a capability the panel did not declare, MADP answers
`501 {code: 'capability_not_supported', capability}` **before anything is sent** to the panel, and the screen says
"<panel> does not offer <feature>". A panel can start with the core set and add features later.

## 7. Read and sync routes

- `GET /api/v1/question` → `Question[]`. `name` is the question key and must be unique per panel.
- `GET /api/v1/option/{question}` → `Option[]`.
- `GET /api/v1/profile` → `Profile[]`, each with `pages`: arrays of question names.
- `GET /api/v1/user` → `Member[]` (full import, optional).
- `GET /api/v1/user/{id}/profile` → answers keyed by question name (optional).
- `GET /api/v1/changes/{members|answers|deletions|rewards|responses}?cursor=&since=&limit=` →
  `{items, cursor, more}`.

Changes feed rules: ordered by `(updatedAt, _id)`; the newest 5 seconds are held back so a late write is never skipped;
`cursor` is opaque and MADP sends it back unchanged; `since` (ISO time) is used only when there is no cursor; `more:
false` means caught up. The members feed includes deactivated and soft-deleted members (`isDeleted`). Deleting a member
or resetting answers writes a tombstone (`kind: 'member' | 'answers'`), so MADP deletes them too. Rewards carry no
free-text remarks and responses no telemetry. Staff and integration accounts carry `isStaff: true`.

## 8. Privacy rules that are part of the contract

- DEMO data stays labelled: `demo-` ids and `@example.invalid` e-mails in any test or fixture.
- A panel that holds health answers declares `special_category`. MHO is always special-category in MADP whatever it
  declares. MADP never infers a health fact from membership of a panel.
- The conformance kit and MADP read personal data only after the owner approves live sync for that panel.

## 9. How MADP uses the contract (the adapter layer)

```
console screens ─┐                                ┌─► PanelApiConnector  ─ bearer ─► /api/v1/question, /changes/*, ...
sync, import  ───┼─► ConnectorRegistry ───────────┤
                 │   (what the panel declared)    └─► PanelAdminClient   ─ signed ─► /api/v1/admin/*
                 └─► PanelAdminService.call ─ capability check (501 if not declared)
```

- Routes come only from `@madp/panel-contract`; `packages/connectors` fills them in and maps T2O records to MADP's
  canonical types (`mapping.ts`).
- **Check contract** on Panel connections reads discovery (with the sync token, and signed when the admin API is set)
  and saves version, brands and capabilities in `panel_connection` (migration 0031). From then on MADP calls only those.
- Until a check passes, MADP **assumes the shared backend** (`SHARED_BACKEND_CAPABILITIES`: everything except
  `special_category` and `webhooks.push`), so T2O, MFR and MHO keep working today.
- A changes feed the panel did not declare is reported as "not supported" without calling it.

## 10. Versioning

Semantic versioning, separate from `/api/v1` in the path (that is the panel's own API generation).

- **1.0.x**: wording only.
- **1.x.0**: additive only: new optional capabilities, routes, fields or query parameters. A 1.0 panel keeps working
  with a newer MADP and the other way round, because MADP never calls an undeclared capability.
- **2.0.0**: breaking. MADP will then speak both majors for at least six months, and Panel connections shows which
  panel is still on the old one.

What 1.0 pins exactly: every method and path, authentication, the envelope, errors, discovery, the read and sync record
shapes and the changes-feed rules. For admin routes 1.0 pins method, path, authentication, envelope and errors; their
request and answer bodies are those of the shared backend (the reference implementation) as of 2026-11-27, and moving
each one into a zod schema in `records.ts` is planned 1.x work (additive).

## 11. Conformance kit

Read-only: it never calls a route that writes. It checks discovery; that a call without credentials, a wrong token, a
wrong secret, a 10-minute-old timestamp, a replayed nonce (409 or 401) and a changed brand header are all refused; the 404 error
envelope; every declared read route and record shape; that changes feeds page with a moving cursor and honour `since`;
and every declared admin list route. Routes with personal data are probed only with live approval, with `limit` 1 or 2,
and the report keeps counts and problems, never records.

From a terminal (any panel team):

```
pnpm --filter @madp/panel-contract build
PANEL_BASE_URL=https://panel.example PANEL_SYNC_TOKEN=... \
PANEL_ADMIN_SECRET=... PANEL_ORIGIN=panel.example \
node packages/panel-contract/bin/conformance.mjs            # add --allow-personal-data only with the owner's OK
```

Exit code 0 = conformant. From the console: Panel connections → **Run conformance** (Super Admin). When the sync routes
and the admin API are on different hosts, the console runs the kit once per host and shows both.

## 12. Adding a new panel or network

1. Add the panel (Panels screen) and its hostname (Brands & settings).
2. The panel team implements the core routes and discovery, and runs the kit against a test copy until it passes.
3. On Panel connections: save address and token (and admin API if it has one), **Test connection**, **Check
   contract**, **Run conformance**.
4. The owner turns on live sync. Then run conformance again: it now also checks the member-data routes.

A network on other software that cannot serve these routes uses the inbox instead (upload or signed push; see the
Networks screen).

## 13. Status (2026-11-27)

- MADP side: built and tested against the reference panel (unit tests in `packages/panel-contract` and
  `packages/connectors`, integration test `apps/api/test/panel-contract.test.ts`).
- Panel backends (T2O, MFR, MHO): every route is served today except `GET /api/v1/contract`. Checked against the code on
  2026-11-27: the changes feeds match section 7 (`turn2opinion` `app/routes/api/Changes.js`, `utils/changesFeed.js`),
  and the signing matches section 4 (`MFR` `app/admin/auth.js`). Adding discovery is one small route in each of the two
  backends (bearer in the T2O backend, signed in the admin API). Those are panel-repository changes: they need the
  owner's approval before they are merged, and his go-ahead before they are deployed. Until then the three panels run on
  the assumed shared-backend capabilities, which is exactly what they do today.
- No live conformance run has happened yet: the panels are not live and this workspace cannot reach them.
