import { loadApiEnv } from '@madp/config';
import { createApp } from './bootstrap.js';
import { migrationStatus } from './scripts/migrate.js';

const env = loadApiEnv();
// Issue #95: an api on a database that is missing migrations answers every screen with "Failed query". Refuse to
// start instead, and say how to fix it. The Docker image and the Swarm stack run migrate.js first, so this only trips
// when the api was started some other way.
const status = await migrationStatus(env.DATABASE_URL);
if (status.pending.length) {
  console.error(
    `The database is missing ${status.pending.length} migration(s): ${status.pending.join(', ')}. ` +
      'Run `node dist/scripts/migrate.js` (or `pnpm db:migrate`) with the same DATABASE_URL, then start the api again.',
  );
  process.exit(1);
}
const app = await createApp(env);
await app.listen(env.PORT);
console.log(`MADP API listening on :${env.PORT}`);
