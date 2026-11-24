#!/usr/bin/env node
// Read-only load test for the MADP API. Never point it at production without the owner's approval.
// Usage: MADP_API=http://localhost:4000/api/v1 MADP_TOKEN=... node ops/load/load-test.mjs [seconds=20] [concurrency=16]
// The token is read from the environment so it never lands in shell history.
const API = process.env.MADP_API ?? 'http://localhost:4000/api/v1';
const TOKEN = process.env.MADP_TOKEN;
if (!TOKEN) {
  console.error('Set MADP_TOKEN (an admin session token for a test environment).');
  process.exit(2);
}
const seconds = Number(process.argv[2] ?? 20);
const concurrency = Number(process.argv[3] ?? 16);

/** A realistic mix of the heaviest admin reads. Weights add up to 100. */
const MIX = [
  { name: 'audience counts', weight: 30, method: 'POST', path: '/audience/counts', body: {} },
  { name: 'audience counts, filtered', weight: 15, method: 'POST', path: '/audience/counts', body: { panels: ['t2o', 'mho'], categories: ['consumer'] } },
  { name: 'geography, world', weight: 10, method: 'POST', path: '/audience/geo', body: {} },
  { name: 'overlap', weight: 5, method: 'POST', path: '/audience/overlap', body: {} },
  { name: 'panellist directory', weight: 15, method: 'GET', path: '/panellists?limit=50' },
  { name: 'verification summary', weight: 5, method: 'GET', path: '/verification/summary' },
  { name: 'consent summary', weight: 5, method: 'GET', path: '/consent/summary' },
  { name: 'report: audience by country', weight: 10, method: 'GET', path: '/reports/audience_by_country' },
  { name: 'health', weight: 5, method: 'GET', path: '/health' },
];
const pick = (() => {
  const bag = MIX.flatMap((m) => Array(m.weight).fill(m));
  return () => bag[Math.floor(Math.random() * bag.length)];
})();

const stats = new Map(MIX.map((m) => [m.name, { lat: [], errors: 0, codes: {} }]));
const end = Date.now() + seconds * 1000;
async function worker() {
  while (Date.now() < end) {
    const m = pick();
    const t0 = performance.now();
    let status = 0;
    try {
      const r = await fetch(API + m.path, {
        method: m.method,
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-madp-brand': 'all' },
        body: m.body ? JSON.stringify(m.body) : undefined,
      });
      status = r.status;
      await r.arrayBuffer();
    } catch {
      status = -1;
    }
    const s = stats.get(m.name);
    s.lat.push(performance.now() - t0);
    s.codes[status] = (s.codes[status] ?? 0) + 1;
    if (status < 200 || status >= 300) s.errors++;
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = (Date.now() - started) / 1000;

const q = (a, p) => (a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
let total = 0;
let errors = 0;
const rows = [];
for (const [name, s] of stats) {
  total += s.lat.length;
  errors += s.errors;
  rows.push({ name, requests: s.lat.length, p50: q(s.lat, 50), p95: q(s.lat, 95), p99: q(s.lat, 99), errors: s.errors });
}
const all = [...stats.values()].flatMap((s) => s.lat);
console.log(`| Endpoint | Requests | p50 ms | p95 ms | p99 ms | Errors |`);
console.log(`| --- | ---: | ---: | ---: | ---: | ---: |`);
for (const r of rows) console.log(`| ${r.name} | ${r.requests} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.errors} |`);
console.log(`| **All** | ${total} | ${q(all, 50).toFixed(0)} | ${q(all, 95).toFixed(0)} | ${q(all, 99).toFixed(0)} | ${errors} |`);
const codes = {};
for (const s of stats.values()) for (const [c, n] of Object.entries(s.codes)) codes[c] = (codes[c] ?? 0) + n;
console.log(`\nStatus codes: ${Object.entries(codes).map(([c, n]) => `${c === '-1' ? 'network error' : c} × ${n}`).join(', ')}`);
console.log(`${concurrency} concurrent clients for ${elapsed.toFixed(1)} s: ${(total / elapsed).toFixed(1)} requests/s, error rate ${((errors / Math.max(1, total)) * 100).toFixed(2)}%.`);
process.exitCode = errors / Math.max(1, total) > 0.01 ? 1 : 0;
