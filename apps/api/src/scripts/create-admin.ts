import { parseArgs } from 'node:util';
import { loadApiEnv, withSecretFiles } from '@madp/config';
import { PanelCode, RoleKey } from '@madp/contracts';
import { createApp } from '../bootstrap.js';
import { AuthService } from '../auth/auth.service.js';
import { runMigrations } from './migrate.js';

// Usage: MADP_ADMIN_PASSWORD=... pnpm --filter @madp/api admin:create --email you@company --name "Your Name" --role super_admin
//        [--brands mfr,t2o]   (default: every brand)
// The password is read from the environment so it never lands in shell history or process listings.
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'super_admin' },
    brands: { type: 'string' },
  },
});
const password = withSecretFiles().MADP_ADMIN_PASSWORD;
if (!values.email || !values.name || !password) {
  console.error('Required: --email, --name and MADP_ADMIN_PASSWORD in the environment');
  process.exit(2);
}
const env = loadApiEnv();
// Apply any pending migrations first (idempotent, and locked against a starting api), so a fresh database works too.
await runMigrations(env.DATABASE_URL, { log: console.log });
const app = await createApp(env, { logger: false });
const brands = values.brands ? values.brands.split(',').map((b) => PanelCode.parse(b.trim())) : null;
const id = await app
  .get(AuthService)
  .createAdminWithGrants(values.email, values.name, password, [{ role: RoleKey.parse(values.role), brands }]);
console.log(
  `Created admin ${values.email} (${values.role} on ${brands ? brands.join(', ') : 'every brand'}) id=${id}. They must enrol MFA at first sign-in.`,
);
await app.close();
