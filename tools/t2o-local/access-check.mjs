// Before/after check for T2O-SEC-03 on the local copy. Prints one line per rule; exits 1 if any rule fails.
import fs from 'node:fs';
import { call } from './lib.mjs';
const t = JSON.parse(fs.readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const me = t.consumer,
  other = t.professional,
  admin = t.integration;
const rows = [];
const check = (name, ok, detail) => rows.push({ name, ok, detail });
let r;
r = await call('GET', '/user', null, me.token);
check('member: GET /user is refused', r.http === 403, r.http);
r = await call('POST', '/user', {}, me.token);
check(
  'member: POST /user lists only own referrals',
  r.http === 200 && r.data.length === 0,
  `${r.http} ${r.data?.length}`,
);
r = await call('POST', '/user', { category: 'minor' }, me.token);
check(
  'member: POST /user ignores other filters',
  r.http === 200 && r.data.length === 0,
  `${r.http} ${r.data?.length}`,
);
r = await call('POST', '/user', { mail: 'madp.professional@t2o-local.test' }, me.token);
check(
  'member: settings e-mail check still answers "taken"',
  r.http === 200 && r.data.length === 1 && Object.keys(r.data[0]).length === 0,
  JSON.stringify(r.data),
);
r = await call('POST', '/user', { mail: 'nobody@t2o-local.test' }, me.token);
check(
  'member: settings e-mail check still answers "free"',
  r.http === 200 && r.data.length === 0,
  JSON.stringify(r.data),
);
r = await call('GET', `/user/${other.userID}`, null, me.token);
check("member: another member's record is refused", r.http === 403, r.http);
r = await call('GET', `/user/${other.userID}/profile`, null, me.token);
check("member: another member's answers are refused", r.http === 403, r.http);
r = await call('GET', `/user/${other.userID}/survey`, null, me.token);
check("member: another member's surveys are refused", r.http === 403, r.http);
r = await call('POST', `/user/${other.userID}/profile-data`, { questions: ['gender'] }, me.token);
check("member: another member's profile-data is refused", r.http === 403, r.http);
r = await call('GET', `/user/${me.userID}/profile`, null, me.token);
check('member: own answers still readable', r.http === 200, r.http);
r = await call('PUT', `/user/${other.userID}`, { terms: [] }, me.token);
check('member: changing another member is refused', r.http === 403, r.http);
r = await call('DELETE', `/user/${other.userID}`, null, me.token);
check('member: deleting another member is refused', r.http === 403, r.http);
r = await call('PUT', `/user/${me.userID}`, { terms: ['terms', 'privacy'], role: 'root' }, me.token);
check('member: own terms update works', r.http === 200, r.http);
r = await call('GET', '/me/profile', null, me.token);
check(
  'member: role cannot be self-assigned',
  r.http === 200 && !['root', 'admin'].includes(r.data?.role),
  r.data?.role,
);
r = await call('POST', '/user/autologin', { _id: other.userID }, me.token);
check('member: autologin as someone else is refused', r.http === 403 && !r.token, r.http);
r = await call('GET', '/user/summarize', null, me.token);
check('member: summary is refused', r.http === 403, r.http);
r = await call('POST', '/user/refresh', { _id: other.userID });
check('anonymous: refresh is refused', r.http === 401, r.http);
r = await call('GET', '/user/apps');
check('anonymous: app list is refused', r.http === 401, r.http);
r = await call('PATCH', '/user/apps', { _id: other.userID, role: 'root' });
check('anonymous: app update is refused', r.http === 401, r.http);
r = await call('PATCH', `/user/${other.userID}`, { action: 'anything' });
check(
  'anonymous: PATCH /user/:id returns no record',
  r.http === 200 && Array.isArray(r.data) && r.data.length === 0,
  JSON.stringify(r.data).slice(0, 60),
);
r = await call('POST', '/user/check', { mail: { $ne: null } });
check('anonymous: /check rejects operator filters', r.http !== 200 || r.data === 0, `${r.http} ${r.data}`);
r = await call('POST', '/user/check', { mail: 'madp.consumer@t2o-local.test' });
check('anonymous: /check still answers for an e-mail', r.http === 200 && r.data === 1, `${r.http} ${r.data}`);
r = await call('GET', '/user', null, admin.token);
check('admin: GET /user works', r.http === 200 && r.data.length >= 5, `${r.http} ${r.data?.length}`);
r = await call('POST', '/user', { category: 'minor' }, admin.token);
check(
  'admin: filtered list works',
  r.http === 200 && r.data.every((u) => u.category === 'minor'),
  `${r.http} ${r.data?.length}`,
);
r = await call('GET', `/user/${other.userID}/profile`, null, admin.token);
check("admin: a member's answers are readable", r.http === 200, r.http);
for (const x of rows) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}  (${x.detail})`);
fs.writeFileSync(new URL('./access-check.json', import.meta.url), JSON.stringify(rows, null, 1));
process.exit(rows.every((x) => x.ok) ? 0 : 1);
