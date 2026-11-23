import { loadApiEnv } from '@madp/config';
import { createApp } from './bootstrap.js';

const env = loadApiEnv();
const app = await createApp(env);
await app.listen(env.PORT);
console.log(`MADP API listening on :${env.PORT}`);
