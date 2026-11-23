import { call, lastOtpFor } from './lib.mjs';
const PW = process.env.TEST_PW;
const people = [
  {
    key: 'consumer',
    category: 'b2c',
    first: 'MADP Test',
    last: 'Consumer',
    dob: '1990-04-12',
    mail: 'madp.consumer@t2o-local.test',
    gender: 'Female',
  },
  {
    key: 'professional',
    category: 'b2b',
    first: 'MADP Test',
    last: 'Professional',
    dob: '1984-09-03',
    mail: 'madp.professional@t2o-local.test',
    gender: 'Male',
  },
];
const out = {};
for (const p of people) {
  const reg = await call('PUT', '/user', {
    category: p.category,
    name: { first: p.first, last: p.last },
    gender: p.gender,
    dob: p.dob,
    mail: p.mail,
    timezone: 'Asia/Kolkata',
    address: [{ tag: 'home', city: 'mumbai', state: 'maharashtra', country: 'IN' }],
    terms: ['terms', 'privacy'],
    consent: { canAcceptPushNotification: p.key === 'consumer' },
  });
  console.log(p.key, 'register', reg.http, reg.status, reg.message, JSON.stringify(reg.data));
  const userID = reg.data?.user;
  if (!userID) continue;
  const otp = lastOtpFor(userID);
  const code = otp?.otp ?? otp?.code ?? otp;
  const set = await call('PATCH', '/user', { userID, emailOTP: code, password: PW, confirmPassword: PW });
  console.log(p.key, 'activate', set.http, set.status, set.message);
  out[p.key] = { userID, token: set.token };
}
const fs = await import('node:fs');
fs.writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify(out));
