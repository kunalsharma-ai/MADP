// Writes expect.json for apps/api/test/t2o-local.test.ts from the accounts the sign-up scripts created.
import fs from 'node:fs';
const t = JSON.parse(fs.readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const row = (label, key, sourceCategory, canonical, minor, guardian, answers) => ({
  label,
  memberId: t[key].userID,
  sourceCategory,
  canonical,
  minor,
  guardian,
  answers,
});
fs.writeFileSync(
  new URL('./expect.json', import.meta.url),
  JSON.stringify(
    [
      row('consumer', 'consumer', 'b2c', 'consumer', false, null, 7),
      row('business professional', 'professional', 'b2b', 'business_professional', false, null, 4),
      row('teen, guardian approved', 'teen_approved', 'minor', 'consumer', true, 'granted', 10),
      row('teen, guardian not yet decided', 'teen_pending', 'minor', 'consumer', true, 'unknown', 0),
      // Present once signup-teen-fixed.mjs and signup-admin.mjs have run (after the T2O fixes).
      ...(t.teen_fixed
        ? [row('teen, approved after the OTP fix', 'teen_fixed', 'minor', 'consumer', true, 'granted', 0)]
        : []),
      // The integration account is not listed: the panel marks it as staff and MADP does not import it.
    ],
    null,
    1,
  ),
);
