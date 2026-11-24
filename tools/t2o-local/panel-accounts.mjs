// Test accounts for MFR or MHO on the local copy of the shared panel backend, made through the panel's own sign-up,
// e-mail code, guardian and activation routes, then answers through /me/profile, then an admin integration account.
//
//   PANEL=mfr TEST_PW=$(cat test-password.txt) node panel-accounts.mjs     # or PANEL=mho
//   BANK=<path to the panel's source-sample.json> when run from a copy outside the repo
//
// Needs <panel>.localhost in /etc/hosts, the panel's bank seeded (seed-bank.mjs) and scripts/golive-setup.js run for
// <panel>.localhost. Writes tokens-<panel>.json and expect-<panel>.json for apps/api/test/t2o-local.test.ts.
// All accounts are test accounts: names start with "MADP Test" and e-mails use the reserved .test domain.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PANEL = process.env.PANEL;
if (!['mfr', 'mho'].includes(PANEL)) throw new Error('PANEL=mfr or PANEL=mho');
const PW = process.env.TEST_PW;
if (!PW) throw new Error('TEST_PW is required');
process.env.T2O_LOCAL_API = `http://${PANEL}.localhost/api/v1`;
const { call, outbox } = await import('./lib.mjs');
const here = (f) => new URL(`./${f}`, import.meta.url);
const mail = (k) => `madp.${k}@${PANEL}-local.test`;
const bank = JSON.parse(
  fs.readFileSync(
    process.env.BANK ??
      new URL(`../../packages/testing/src/fixtures/${PANEL}.source-sample.json`, import.meta.url),
    'utf8',
  ),
);

// Source category the sign-up sends -> what the panel stores, and what MADP should make of it.
const PEOPLE = {
  mfr: [
    { key: 'consumer', category: 'b2c', stored: 'b2c', canonical: 'consumer', dob: '1991-03-04' },
    {
      key: 'professional',
      category: 'b2b',
      stored: 'b2b',
      canonical: 'business_professional',
      dob: '1983-07-21',
    },
    {
      key: 'teen_approved',
      category: 'b2c',
      stored: 'minor',
      canonical: 'consumer',
      dob: '2010-05-05',
      guardian: 'yes',
    },
    {
      key: 'teen_pending',
      category: 'b2c',
      stored: 'minor',
      canonical: 'consumer',
      dob: '2011-01-20',
      guardian: 'none',
    },
  ],
  mho: [
    {
      key: 'hcp',
      category: 'healthcare professional',
      stored: 'healthcare professional',
      canonical: 'healthcare_professional',
      dob: '1979-11-02',
    },
    { key: 'patient', category: 'patient', stored: 'patient', canonical: 'patient', dob: '1988-02-14' },
    {
      key: 'caregiver',
      category: 'care giver',
      stored: 'care giver',
      canonical: 'caregiver',
      dob: '1975-08-30',
    },
    {
      key: 'teen_approved',
      category: 'patient',
      stored: 'minor patient',
      canonical: 'patient',
      dob: '2010-05-05',
      guardian: 'yes',
    },
    {
      key: 'teen_pending',
      category: 'patient',
      stored: 'minor patient',
      canonical: 'patient',
      dob: '2011-01-20',
      guardian: 'none',
    },
  ],
}[PANEL];

const STATEMENTS = [
  'guardian-aware',
  'terms',
  'privacy',
  'teen-notice',
  'how-it-works',
  'accurate',
  'not-consent',
];
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
const linkFrom = (url) => {
  const u = new URL(url);
  return { code: u.searchParams.get('code'), s: u.searchParams.get('s') };
};
const lastTemplate = (userId, test) =>
  outbox()
    .filter((m) => m.svc === 'template' && String(m.data?.user?._id) === String(userId) && test(m))
    .at(-1);
const otpFor = (userId) => {
  const o = lastTemplate(userId, (m) => m.data?.otp)?.data?.otp;
  return o?.code ?? o?.otp ?? o;
};
const mongo = (js) =>
  execFileSync('docker', ['exec', 'madp-mongo', 'mongosh', '--quiet', 't2o_local', '--eval', js], {
    encoding: 'utf8',
  }).trim();

const tokens = {};
const expect = [];
for (const p of PEOPLE) {
  const teen = Boolean(p.guardian);
  const reg = await call('PUT', '/user', {
    category: p.category,
    name: { first: 'MADP Test', last: `${PANEL.toUpperCase()} ${p.key.replace('_', ' ')}` },
    gender: 'Other',
    dob: p.dob,
    mail: mail(p.key),
    timezone: 'Asia/Kolkata',
    address: [{ tag: 'home', city: 'pune', state: 'maharashtra', country: 'IN' }],
    terms: ['terms', 'privacy'],
    ...(teen
      ? {
          parent: {
            email: mail(`${p.key}.guardian`),
            relation: 'mother',
            name: { first: 'MADP Test', last: 'Guardian' },
          },
          teenConsent: { statements: STATEMENTS },
        }
      : {}),
  });
  console.log(p.key, 'register', reg.http, reg.message ?? '');
  const id = reg.data?.user;
  if (!id) throw new Error(`${p.key}: sign-up failed: ${reg.message}`);
  let token;
  if (!teen) {
    const set = await call('PATCH', '/user', {
      userID: id,
      emailOTP: otpFor(id),
      password: PW,
      confirmPassword: PW,
    });
    console.log(p.key, 'activate', set.http, set.message ?? '');
    token = set.token;
  } else if (p.guardian === 'yes') {
    const link = linkFrom(lastTemplate(id, (m) => m.data?.links?.open).data.links.open);
    const d = await call('POST', `/user/parent-decision/${id}`, { ...link, decision: 'yes' });
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
    const c = await call('PUT', `/user/parent-consent/${id}`, {
      ...link,
      declaration: true,
      termsRead: true,
      selections: { participation: true, privacy: true, contact: true },
    });
    const a = linkFrom(lastTemplate(id, (m) => m.data?.activate).data.activate);
    const set = await call('PATCH', '/user', {
      userID: id,
      emailOTP: a.code,
      sig: a.s,
      password: PW,
      confirmPassword: PW,
    });
    console.log(p.key, 'guardian', d.http, o.http, c.http, 'activate', set.http, set.message ?? '');
    token = set.token;
  }
  const stored = mongo(`print(db.User.findOne({_id: ObjectId("${id}")}).category)`);
  if (stored !== p.stored)
    throw new Error(`${p.key}: panel stored category "${stored}", expected "${p.stored}"`);

  // Answers: the member's own questionnaires in this panel's bank, choice questions only.
  let answers = 0;
  if (token) {
    const base = p.stored.replace(/^minor /, '');
    const opts = new Map();
    for (const o of bank.options)
      if (!(o.parentValue ?? []).length)
        (opts.get(o.question) ?? opts.set(o.question, []).get(o.question)).push(o.value);
    const pool = bank.profiles
      .filter((x) => x.sourceCategory === base || (PANEL === 'mfr' && x.sourceCategory === 'b2c'))
      .flatMap((x) => x.pages.flatMap((pg) => pg.slice(1)))
      .filter((q, i, all) => all.indexOf(q) === i && !SKIP.has(q) && opts.get(q)?.length);
    const body = Object.fromEntries(pool.slice(0, 8).map((q, i) => [q, opts.get(q)[i % opts.get(q).length]]));
    answers = Object.keys(body).length;
    if (answers) {
      const r = await call('PATCH', '/me/profile', body, token);
      if (r.http !== 200) throw new Error(`${p.key}: answers not saved: ${r.message}`);
    }
    console.log(p.key, 'answered', answers);
  }
  tokens[p.key] = { userID: id, ...(token ? { token } : {}) };
  expect.push({
    label: `${PANEL} ${p.key.replace('_', ' ')}`,
    memberId: id,
    sourceCategory: p.stored,
    canonical: p.canonical,
    minor: teen,
    guardian: teen ? (p.guardian === 'yes' ? 'granted' : 'unknown') : null,
    answers,
  });
}

// The MADP integration account: created like a member, then given the admin role in the local database, the way
// an operator would in the panel's admin area.
const reg = await call('PUT', '/user', {
  category: 'b2c',
  name: { first: 'MADP', last: 'Integration' },
  gender: 'Other',
  dob: '1990-01-01',
  mail: mail('integration'),
  timezone: 'Asia/Kolkata',
  terms: ['terms'],
});
const iid = reg.data.user;
const iset = await call('PATCH', '/user', {
  userID: iid,
  emailOTP: otpFor(iid),
  password: PW,
  confirmPassword: PW,
});
mongo(`db.User.updateOne({_id: ObjectId("${iid}")}, {$set: {role: "admin"}})`);
console.log('integration account', reg.http, iset.http);
tokens.integration = { userID: iid, token: iset.token };
// Not in expect: the panel marks it as staff (isStaff), and MADP leaves it out of its members.

fs.writeFileSync(here(`tokens-${PANEL}.json`), JSON.stringify(tokens));
fs.writeFileSync(here(`expect-${PANEL}.json`), JSON.stringify(expect, null, 1));
console.log(`wrote tokens-${PANEL}.json and expect-${PANEL}.json (${expect.length} accounts)`);
