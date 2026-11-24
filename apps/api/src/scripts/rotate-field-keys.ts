import { parseArgs } from 'node:util';
import { loadApiEnv } from '@madp/config';
import { createApp } from '../bootstrap.js';
import { KeyRotationService } from '../crypto/key-rotation.service.js';

// Usage: pnpm --filter @madp/api keys:rotate [--status] [--batch 500]
// Set FIELD_ENCRYPTION_KEYS and FIELD_ENCRYPTION_ACTIVE_KEY first (docs/SECURITY_PRIVACY.md, "Key rotation").
const { values } = parseArgs({ options: { status: { type: 'boolean' }, batch: { type: 'string' } } });
const app = await createApp(loadApiEnv(), { logger: false });
const svc = app.get(KeyRotationService);
if (values.status) console.log(JSON.stringify(await svc.status(), null, 1));
else console.log(JSON.stringify(await svc.rotate({ batchSize: values.batch ? Number(values.batch) : undefined }), null, 1));
await app.close();
