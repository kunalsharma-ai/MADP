import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { loadApiEnv, type ApiEnv } from '@madp/config';
import { createApp } from '../src/bootstrap.js';
import { runMigrations } from '../src/scripts/migrate.js';
import { AuthService } from '../src/auth/auth.service.js';

/**
 * Integration tests run against real PostgreSQL and MongoDB (docker compose locally, service containers in CI).
 * Each run creates and drops its own throw-away database.
 */
export const TEST_PG = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://madp:madp@localhost:5432/postgres';
export const TEST_MONGO = process.env.TEST_MONGODB_URL ?? 'mongodb://localhost:27017';

export async function startTestApp(overrides: Partial<Record<string, string>> = {}) {
  const name = `madp_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_PG });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const dbUrl = new URL(TEST_PG);
  dbUrl.pathname = `/${name}`;
  await runMigrations(dbUrl.toString());
  const env: ApiEnv = loadApiEnv({
    NODE_ENV: 'test',
    DATABASE_URL: dbUrl.toString(),
    MONGODB_URL: TEST_MONGO,
    MONGODB_DB: name,
    AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PII_HASH_KEY: randomBytes(32).toString('hex'),
    DEMO_POPULATION_SIZE: '400',
    ...overrides,
  });
  const app = await createApp(env, { logger: false });
  await app.init();
  const server = app.getHttpServer();
  const auth = app.get(AuthService);

  async function stop() {
    await app.close();
    const m = new MongoClient(TEST_MONGO);
    await m.connect();
    await m.db(name).dropDatabase();
    await m.close();
    const c = new pg.Client({ connectionString: TEST_PG });
    await c.connect();
    await c.query(`drop database if exists ${name} with (force)`);
    await c.end();
  }

  /** Creates an admin, enrols MFA through the real endpoints, returns a full-scope token. */
  async function adminToken(
    role: Parameters<AuthService['createAdmin']>[3],
    email = `${role}@example.invalid`,
  ) {
    const password = 'correct horse battery staple';
    await auth.createAdmin(email, role, password, role);
    const login = await request(server).post('/api/v1/auth/login').send({ email, password }).expect(200);
    if (!login.body.mfaSetupRequired) return { token: login.body.token as string, totp: null };
    const setup = await request(server)
      .post('/api/v1/auth/mfa/setup')
      .set('authorization', `Bearer ${login.body.token}`)
      .expect(200);
    const totp = OTPAuth.URI.parse(setup.body.otpauthUri) as OTPAuth.TOTP;
    const confirm = await request(server)
      .post('/api/v1/auth/mfa/confirm')
      .set('authorization', `Bearer ${login.body.token}`)
      .send({ code: totp.generate() })
      .expect(200);
    return { token: confirm.body.token as string, totp };
  }

  return { app, server, env, stop, adminToken, dbUrl: dbUrl.toString() };
}
