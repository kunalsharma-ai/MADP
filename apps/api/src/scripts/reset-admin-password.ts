import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadApiEnv, withSecretFiles } from '@madp/config';
import { createApp } from '../bootstrap.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { Database } from '../db/database.js';
import { adminUsers } from '../db/schema.js';

// Issue #94, for when no Super Admin can sign in to reset a password from the Admins screen.
// Usage: MADP_ADMIN_PASSWORD=... node dist/scripts/reset-admin-password.js --email you@company [--reset-mfa]
// The password is read from the environment so it never lands in shell history or process listings. The account is
// unlocked and every session ends. --reset-mfa also clears the authenticator (a lost phone): enrol again at sign-in.
const { values } = parseArgs({
  options: { email: { type: 'string' }, 'reset-mfa': { type: 'boolean', default: false } },
});
const password = withSecretFiles().MADP_ADMIN_PASSWORD;
if (!values.email || !password) {
  console.error('Required: --email and MADP_ADMIN_PASSWORD in the environment');
  process.exit(2);
}
if (password.length < 12) {
  console.error('MADP_ADMIN_PASSWORD must be at least 12 characters');
  process.exit(2);
}
const app = await createApp(loadApiEnv(), { logger: false });
try {
  const email = values.email.toLowerCase();
  const user = await app.get(Database).db.query.adminUsers.findFirst({ where: eq(adminUsers.email, email) });
  if (!user) {
    console.error(`No admin with the e-mail ${email}`);
    process.exitCode = 1;
  } else {
    const resetMfa = values['reset-mfa'] ?? false;
    await app.get(AuthService).setPassword(user.id, password, { resetMfa });
    await app.get(AuditService).record({
      actorId: null,
      actorType: 'system',
      action: 'admins.password_reset',
      targetType: 'admin_user',
      targetId: user.id,
      metadata: { via: 'server_command', resetMfa },
      reason: 'Reset with reset-admin-password on the server',
    });
    console.log(
      `Password reset for ${email}. The account is unlocked and signed out everywhere.` +
        (resetMfa ? ' Two-factor was cleared: they set up the authenticator again at the next sign-in.' : ''),
    );
  }
} finally {
  await app.close();
}
