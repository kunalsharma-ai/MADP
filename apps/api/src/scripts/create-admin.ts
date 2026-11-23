import { parseArgs } from 'node:util';
import { loadApiEnv } from '@madp/config';
import { AdminRole } from '@madp/contracts';
import { createApp } from '../bootstrap.js';
import { AuthService } from '../auth/auth.service.js';

// Usage: MADP_ADMIN_PASSWORD=... pnpm --filter @madp/api admin:create --email you@company --name "Your Name" --role super_admin
// The password is read from the environment so it never lands in shell history or process listings.
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'super_admin' } } });
const password = process.env.MADP_ADMIN_PASSWORD;
if (!values.email || !values.name || !password) {
  console.error('Required: --email, --name and MADP_ADMIN_PASSWORD in the environment');
  process.exit(2);
}
const app = await createApp(loadApiEnv(), { logger: false });
const id = await app.get(AuthService).createAdmin(values.email, values.name, password, AdminRole.parse(values.role));
console.log(`Created admin ${values.email} (${values.role}) id=${id}. They must enrol MFA at first sign-in.`);
await app.close();
