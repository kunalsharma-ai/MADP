import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import './auth/auth.types.js';
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
  // Request id for the audit trail: the caller's x-request-id when it looks safe, otherwise a new one.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const given = String(req.headers['x-request-id'] ?? '');
    req.requestId = /^[A-Za-z0-9._-]{8,80}$/.test(given) ? given : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.enableCors({ origin: env.ADMIN_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}
