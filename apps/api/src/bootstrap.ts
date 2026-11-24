import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { ApiEnv } from '@madp/config';
import { AppModule } from './app.module.js';

export async function createApp(env: ApiEnv, opts: { logger?: boolean } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    logger: opts.logger === false ? false : ['log', 'warn', 'error'],
    // Webhook signatures are checked against the exact bytes received.
    rawBody: true,
  });
  app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: env.ADMIN_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}
