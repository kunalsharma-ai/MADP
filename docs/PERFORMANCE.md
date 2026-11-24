# Performance baseline

Measured with `ops/load/load-test.mjs`: a read-only weighted mix of the busiest admin calls (audience counts, filtered
counts, geography, overlap, the panellist directory, the verification and consent summaries, a report, and health).

**These are local numbers on DEMO data, not production.** They ran on a single development container: the API, Postgres
18 and MongoDB 8 shared the same machine, with no read replica, no CDN and no tuning. Use them as a baseline to compare
against, not as a promise.

How to run it against a test environment (never production):

```
MADP_API=https://<test-api>/api/v1 MADP_TOKEN=<admin session token> node ops/load/load-test.mjs <seconds> <concurrency>
```

The API limits each client address to `RATE_LIMIT_PER_MINUTE` requests a minute (default 300). A load test from one
machine hits that limit within seconds, so raise it only in the test environment. Leave the default in production.

## 2026-11-24: 5,000 demo people, all three panels

The database held 5,883 panel memberships (T2O 1,965, MFR 1,937, MHO 1,981), all DEMO fixtures.

16 concurrent clients for 60 seconds:

| Endpoint | Requests | p50 ms | p95 ms | p99 ms | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| audience counts | 1370 | 192 | 264 | 311 | 0 |
| audience counts, filtered | 683 | 268 | 351 | 392 | 0 |
| geography, world | 480 | 121 | 174 | 196 | 0 |
| overlap | 243 | 134 | 188 | 209 | 0 |
| panellist directory | 635 | 54 | 91 | 117 | 0 |
| verification summary | 239 | 409 | 529 | 585 | 0 |
| consent summary | 220 | 934 | 1252 | 4781 | 0 |
| report: audience by country | 482 | 59 | 99 | 141 | 0 |
| health | 200 | 13 | 28 | 44 | 0 |
| **All** | 4552 | 169 | 557 | 1073 | 0 |

Status codes: 200 × 4552
16 concurrent clients for 60.3 s: 75.5 requests/s, error rate 0.00%.

4 concurrent clients for 30 seconds: 77.2 requests/s, error rate 0.00%. Overall p50 40 ms, p95 254 ms, p99 306 ms.

## 2026-11-24: 300 demo people (preview database)

16 concurrent clients for 30 seconds:

| Endpoint | Requests | p50 ms | p95 ms | p99 ms | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| audience counts | 2671 | 52 | 75 | 91 | 0 |
| audience counts, filtered | 1292 | 64 | 93 | 115 | 0 |
| geography, world | 938 | 34 | 51 | 60 | 0 |
| overlap | 438 | 35 | 54 | 61 | 0 |
| panellist directory | 1334 | 25 | 39 | 49 | 0 |
| verification summary | 486 | 193 | 280 | 328 | 0 |
| consent summary | 460 | 98 | 141 | 166 | 0 |
| report: audience by country | 862 | 21 | 36 | 45 | 0 |
| health | 432 | 6 | 15 | 20 | 0 |
| **All** | 8913 | 45 | 154 | 229 | 0 |

Status codes: 200 × 8913
16 concurrent clients for 30.0 s: 296.8 requests/s, error rate 0.00%.

## What this shows

- No errors at either size, and throughput stays about the same (75 to 77 requests a second) whether 4 or 16 clients
  are waiting. That means the single local Postgres is the limit, not the API.
- Most calls stay under 300 ms at the 95th percentile with 5,000 people.
- **The consent summary is the slowest call:** p50 934 ms, with a p99 of 4.8 s at 16 clients. The verification summary
  comes next at about 0.5 s. Both compute over every membership on each call. Before going live they should be cached
  for a short time or precomputed, the way audience counts already are. This is a follow-up, not done yet.
- Audience counts grow with the population (about 50 ms at 300 people, 190 ms at 5,000). At the real panel sizes,
  check that the count cache is used.
