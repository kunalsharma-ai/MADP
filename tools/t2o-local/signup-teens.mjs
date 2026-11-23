import fs from 'node:fs';
import { call, outbox } from './lib.mjs';
const PW = process.env.TEST_PW;
const STATEMENTS = [
  'guardian-aware',
  'terms',
  'privacy',
  'teen-notice',
  'how-it-works',
  'accurate',
  'not-consent',
];
const linkFrom = (url) => {
  const u = new URL(url);
  return { code: u.searchParams.get('code'), s: u.searchParams.get('s') };
};
const lastTemplate = (userId, test) =>
  outbox()
    .filter((m) => m.svc === 'template' && String(m.data?.user?._id) === String(userId) && test(m))
    .at(-1);
const teens = [
  {
    key: 'teen_approved',
    last: 'Teen Approved',
    mail: 'madp.teen1@t2o-local.test',
    parent: 'madp.guardian1@t2o-local.test',
    approve: true,
  },
  {
    key: 'teen_pending',
    last: 'Teen Pending',
    mail: 'madp.teen2@t2o-local.test',
    parent: 'madp.guardian2@t2o-local.test',
    approve: false,
  },
];
const tokens = JSON.parse(fs.readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
for (const t of teens) {
  const reg = await call('PUT', '/user', {
    category: 'b2c',
    name: { first: 'MADP Test', last: t.last },
    gender: 'Other',
    dob: '2010-06-15',
    mail: t.mail,
    timezone: 'Asia/Kolkata',
    address: [{ tag: 'home', city: 'pune', state: 'maharashtra', country: 'IN' }],
    terms: ['terms', 'privacy'],
    parent: { email: t.parent, relation: 'mother', name: { first: 'MADP Test', last: 'Guardian' } },
    teenConsent: { statements: STATEMENTS },
  });
  console.log(t.key, 'register', reg.http, reg.status, reg.message, JSON.stringify(reg.data));
  const id = reg.data?.user;
  if (!id || !t.approve) {
    tokens[t.key] = { userID: id };
    continue;
  }
  const inv = lastTemplate(id, (m) => m.data?.links?.open);
  const link = linkFrom(inv.data.links.open);
  const d = await call('POST', `/user/parent-decision/${id}`, { ...link, decision: 'yes' });
  console.log(t.key, 'guardian yes', d.http, d.message);
  const o = await call('PUT', `/user/parent-onboarding/${id}`, {
    ...link,
    answers: {
      'parent-first-name': 'MADP Test',
      'parent-last-name': 'Guardian',
      'parent-dob': '1980-02-02',
      P01: 'yes',
      P03: 'mother',
      'parent-marital': 'married',
      P04: 'yes',
      P11: 'yes',
      P06: 'yes',
      P07: ['email'],
      P12: 'yes',
    },
  });
  console.log(t.key, 'guardian onboarding', o.http, o.message);
  const c = await call('PUT', `/user/parent-consent/${id}`, {
    ...link,
    declaration: true,
    termsRead: true,
    selections: { participation: true, privacy: true, contact: true },
  });
  console.log(t.key, 'guardian consent', c.http, c.message, JSON.stringify(c.data));
  const act = lastTemplate(id, (m) => m.data?.activate);
  const a = linkFrom(act.data.activate);
  const set = await call('PATCH', '/user', {
    userID: id,
    emailOTP: a.code,
    sig: a.s,
    password: PW,
    confirmPassword: PW,
  });
  console.log(t.key, 'teen sets password', set.http, set.status, set.message);
  tokens[t.key] = { userID: id, token: set.token };
}
fs.writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify(tokens));
