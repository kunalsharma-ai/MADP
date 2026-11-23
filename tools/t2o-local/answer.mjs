import fs from 'node:fs';
import { call } from './lib.mjs';
const tokens = JSON.parse(fs.readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const f = JSON.parse(
  fs.readFileSync(
    new URL('../../packages/testing/src/fixtures/t2o.source-sample.json', import.meta.url),
    'utf8',
  ),
);
const opts = new Map();
for (const o of f.options)
  if (!o.parentValue.length) (opts.get(o.question) ?? opts.set(o.question, []).get(o.question)).push(o.value);
const SKIP = new Set([
  'firstname',
  'lastname',
  'fullname',
  'mail',
  'alternate-email',
  'workemail',
  'phone',
  'alternate-phone',
  'dob',
  'zipcode',
  'country',
  'state',
  'city',
]);
const plan = { consumer: 'b2c', professional: 'b2b', teen_approved: 'minor' };
for (const [who, cat] of Object.entries(plan)) {
  const t = tokens[who]?.token;
  const profiles = f.profiles.filter(
    (p) => p.sourceCategory === cat || (cat === 'b2b' && p.sourceCategory === 'b2c' && p.slug === 'basic'),
  );
  const pool = profiles
    .slice(0, 3)
    .flatMap((p) => p.pages.flatMap((pg) => pg.slice(1)))
    .filter((q) => !SKIP.has(q) && opts.get(q)?.length);
  const body = Object.fromEntries(pool.slice(0, 12).map((q, i) => [q, opts.get(q)[i % opts.get(q).length]]));
  const r = await call('PATCH', '/me/profile', body, t);
  console.log(who, cat, 'answered', Object.keys(body).length, r.http, r.message);
}
// Security check: what can an ordinary member token read?
const list = await call('GET', '/user', null, tokens.consumer.token);
console.log(
  'GET /user with a consumer member token:',
  list.http,
  Array.isArray(list.data)
    ? `${list.data.length} members returned, fields: ${Object.keys(list.data[0] ?? {})
        .slice(0, 12)
        .join(',')}`
    : list.message,
);
const other = await call('GET', `/user/${tokens.professional.userID}/profile`, null, tokens.consumer.token);
console.log(
  "consumer token reading the professional's profile:",
  other.http,
  other.data ? Object.keys(other.data).length + ' fields' : other.message,
);
