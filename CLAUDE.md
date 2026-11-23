# MADP — notes for Claude Code

MADP (Master Audience Data Platform) unifies three panels: Turn2Opinion (T2O), MyFrequentRewards (MFR) and
MyHealthOpinions (MHO). The spec is `MADP_CLAUDE_CODE_MASTER_PROMPT.md` (kept outside the repo). Progress is in
`docs/PROGRESS.md`, and the per-panel status is in `docs/THREE_PANEL_ACCEPTANCE_MATRIX.md`.

## Rules that are not negotiable

- All three panels are mandatory and equal. Never deliver or mark done for one panel only.
- Never claim a feature works unless it is implemented and tested. Never mark a matrix column passed without live
  evidence.
- DEMO data is always labelled (`data_mode = 'demo'`, `demo-` ids, `@example.invalid` e-mails) and never mixed into
  live counts.
- Get explicit approval from the owner before: reading production personal data, sending any message, changing live
  rewards, deploying, or changing the panel repositories.
- Never commit secrets or production credentials. `.env` is git-ignored; only `.env.example` holds placeholders.
- Do not invent panel endpoints. Panel routes live only in `packages/connectors/src/http-connector.ts` and must match
  the audits.
- Use the latest stable versions, pinned exactly. No alpha, beta, RC or canary.
- MHO answers are special-category by default. Never infer health facts from panel membership.

## Layout

`apps/api` (NestJS 12, Drizzle on Postgres 18, MongoDB 8) · `apps/admin` (Next.js 16) · `packages/contracts` (zod,
the single source of API types) · `packages/config` · `packages/connectors` · `packages/testing` (DEMO fixtures).

## Commands

```
docker compose up -d postgres mongodb redis
cp .env.example .env          # then generate real local secrets (see the comments in the file)
pnpm install
pnpm build && pnpm typecheck
pnpm test                     # unit and contract tests
pnpm test:integration         # needs Postgres and Mongo; each run uses a throwaway database
pnpm db:migrate && pnpm db:seed:demo
pnpm dev                      # API on :4000, admin on :3000
```

## Conventions

- New tables: add `data_mode` if the table can hold panel data, generate a migration with drizzle-kit, never edit an
  applied migration.
- New routes: add `@RequirePermissions`, validate with `ZodPipe` and a schema from `packages/contracts`, audit reads
  of personal data.
- Mapping suggestions stay `pending` until a human decides.
