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
  // The API only serves JSON: no scripts, styles, frames or embedding, nothing cached, no referrer, no device APIs.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      xFrameOptions: { action: 'deny' },
    }),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  // Request id for the audit trail: the caller's x-request-id when it looks safe, otherwise a new one.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const given = String(req.headers['x-request-id'] ?? '');
    req.requestId = /^[A-Za-z0-9._-]{8,80}$/.test(given) ? given : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  // Question bank imports are files of several MB; every other route keeps the default 100 kB JSON limit.
  app.use('/api/v1/panel/qb/import', largeJson(25 * 1024 * 1024));
  app.enableCors({ origin: env.ADMIN_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}

/** JSON body parser for one route with a bigger limit. Marks the body as parsed so the default parser skips it. */
function largeJson(limit: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!/application\/json/i.test(req.headers['content-type'] ?? '')) return next();
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = (status: number, message: string) => {
      if (done) return;
      done = true;
      res.status(status).json({ statusCode: status, message });
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(413, 'File too large');
        req.destroy();
      } else chunks.push(c);
    });
    req.on('error', () => fail(400, 'Bad request body'));
    req.on('end', () => {
      if (done) return;
      const raw = Buffer.concat(chunks);
      try {
        req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      } catch {
        return fail(400, 'Body is not valid JSON');
      }
      (req as Request & { _body?: boolean; rawBody?: Buffer })._body = true;
      (req as Request & { rawBody?: Buffer }).rawBody = raw;
      done = true;
      next();
    });
  };
}
