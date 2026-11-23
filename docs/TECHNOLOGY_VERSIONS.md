# Technology versions

Checked on 2026-11-23 against each project's `latest` dist-tag on npm and the official Docker images. All versions are
pinned exactly (`.npmrc` has `save-exact=true`). No alpha, beta, RC or canary builds are used.

| Area | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node.js LTS | 26.13.1 | `.nvmrc`; `engines` `>=26.13.1 <27` |
| Package manager | pnpm | 12.23.0 | `packageManager` field; `allowBuilds` for native deps |
| Monorepo | Turborepo | 2.11.13 | |
| Language | TypeScript | 7.0.2 | Checked to work with Nest decorators and `emitDecoratorMetadata` |
| API | NestJS | 12.6.0 | `@nestjs/common`, `core`, `platform-express`, `testing` |
| Rate limiting | @nestjs/throttler | 6.8.0 | |
| Headers | helmet | 8.3.0 | |
| Validation and contracts | zod | 4.6.7 | OpenAPI is generated from zod |
| ORM and migrations | Drizzle ORM / drizzle-kit | 0.45.4 / 0.31.11 | |
| Postgres driver | pg | 8.23.1 | |
| MongoDB driver | mongodb | 7.9.1 | |
| Password hashing | argon2 | 0.45.2 | argon2id |
| JWT | jose | 6.2.18 | HS256 |
| TOTP | otpauth | 9.6.0 | |
| Tests | Vitest | 5.1.1 | with `unplugin-swc` 2.0.0 and `@swc/core` 1.16.22 for decorator metadata |
| HTTP tests | supertest | 7.3.2 | |
| Admin web | Next.js | 16.4.6 | App Router, standalone output |
| UI runtime | React / React DOM | 19.3.1 | |
| Styling | Tailwind CSS | 4.3.5 | `@tailwindcss/postcss` |
| Charts | Apache ECharts | 6.1.0 | |
| Command palette | cmdk | 1.1.1 | |
| Icons | lucide-react | 1.78.0 | |
| Theme / toasts / font | next-themes 0.4.6, sonner 2.0.8, geist 1.9.2 | | |
| Formatting | Prettier | 3.10.1 | |
| Database | PostgreSQL | 18 | `postgres:18` image |
| Document store | MongoDB | 8 | `mongo:8` image |
| Cache and queues | Redis | 8 | Provisioned; not used until M2 |

## Rejected or deferred
- **Prisma:** at the time of checking, Prisma's `latest` dist-tag pointed to a release candidate. The spec forbids
  pre-release builds, so Drizzle was chosen. Drizzle also suits the raw SQL needed for counts and the audit trigger.
- **@nestjs/swagger:** its current release declares a TypeScript peer range that excludes TypeScript 7. Rather than
  force a peer override, the OpenAPI document is generated from the shared zod contracts.
- **BullMQ / Redis workers:** deferred to M2, when backfills need to run in the background.
