// A dedicated integration account for MADP: created like any member, then given the admin role in the local
// database (the way an operator would in the T2O admin area).
import fs from 'node:fs';
import { call, lastOtpFor } from './lib.mjs';
const PW = process.env.TEST_PW;
const reg = await call('PUT', '/user', {
  category: 'b2c',
  name: { first: 'MADP', last: 'Integration' },
  gender: 'Other',
  dob: '1990-01-01',
  mail: 'madp.integration@t2o-local.test',
  timezone: 'Asia/Kolkata',
  terms: ['terms'],
});
const id = reg.data.user;
const otp = lastOtpFor(id);
const set = await call('PATCH', '/user', {
  userID: id,
  emailOTP: otp?.code ?? otp,
  password: PW,
  confirmPassword: PW,
});
console.log('integration account', reg.http, set.http, set.message);
const t = JSON.parse(fs.readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
t.integration = { userID: id, token: set.token };
fs.writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify(t));
