import { describe, expect, it } from 'vitest';
import { loadApiEnv, withSecretFiles } from './index.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/madp',
  MONGODB_URL: 'mongodb://localhost:27017',
  AUTH_JWT_SECRET: 'x'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  PII_HASH_KEY: 'h'.repeat(32),
};

describe('loadApiEnv', () => {
  it('defaults to no live source access', () => {
    expect(loadApiEnv(base).LIVE_SOURCE_APPROVED_PANELS).toEqual([]);
  });
  it('parses approved panels and rejects unknown ones', () => {
    expect(
      loadApiEnv({ ...base, LIVE_SOURCE_APPROVED_PANELS: 'T2O, mho' }).LIVE_SOURCE_APPROVED_PANELS,
    ).toEqual(['t2o', 'mho']);
    expect(() => loadApiEnv({ ...base, LIVE_SOURCE_APPROVED_PANELS: 'abc' })).toThrow();
  });
  it('requires MFA unless explicitly disabled', () => {
    expect(loadApiEnv(base).REQUIRE_MFA).toBe(true);
    expect(loadApiEnv({ ...base, REQUIRE_MFA: 'false' }).REQUIRE_MFA).toBe(false);
    expect(() => loadApiEnv({ ...base, NODE_ENV: 'production', REQUIRE_MFA: 'false' })).toThrow(
      /REQUIRE_MFA/,
    );
    expect(loadApiEnv(base).ADMIN_IDLE_MINUTES).toBe(30);
  });
  it('requires a strong signing secret', () => {
    expect(() => loadApiEnv({ ...base, AUTH_JWT_SECRET: 'short' })).toThrow(/AUTH_JWT_SECRET/);
  });
  it('reads extra field keys for rotation and checks the active one exists', () => {
    const k2 = Buffer.alloc(32, 2).toString('base64');
    const env = loadApiEnv({ ...base, FIELD_ENCRYPTION_KEYS: `k2=${k2}`, FIELD_ENCRYPTION_ACTIVE_KEY: 'k2' });
    expect(env.FIELD_ENCRYPTION_KEYS).toEqual({ k2 });
    expect(() => loadApiEnv({ ...base, FIELD_ENCRYPTION_ACTIVE_KEY: 'k3' })).toThrow(
      /not in FIELD_ENCRYPTION_KEYS/,
    );
    expect(() => loadApiEnv({ ...base, FIELD_ENCRYPTION_KEYS: 'k1=abc' })).toThrow(/FIELD_ENCRYPTION_KEYS/);
  });
  it('accepts several webhook secrets per panel and rejects short ones', () => {
    const env = loadApiEnv({ ...base, WEBHOOK_SECRETS_MHO: `${'a'.repeat(32)}, ${'b'.repeat(40)}` });
    expect(env.WEBHOOK_SECRETS_MHO).toHaveLength(2);
    expect(env.WEBHOOK_SECRETS_T2O).toEqual([]);
    expect(() => loadApiEnv({ ...base, WEBHOOK_SECRETS_T2O: 'short' })).toThrow(/WEBHOOK_SECRETS_T2O/);
  });
  it('production needs an https admin origin, and hides the route map unless told otherwise', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadApiEnv({ ...prod, ADMIN_ORIGIN: 'http://admin.example.invalid' })).toThrow(
      /ADMIN_ORIGIN/,
    );
    const ok = loadApiEnv({ ...prod, ADMIN_ORIGIN: 'https://admin.example.invalid' });
    expect(ok.OPENAPI_PUBLIC).toBeUndefined();
    expect(loadApiEnv({ ...base, OPENAPI_PUBLIC: 'true' }).OPENAPI_PUBLIC).toBe(true);
    expect(loadApiEnv(base).ABUSE_MAX_FAILURES).toBe(20);
  });
});

describe('withSecretFiles', () => {
  const files: Record<string, string> = {
    '/run/secrets/jwt': 'j'.repeat(40) + '\n',
    '/run/secrets/db': 'postgres://u:p@postgres:5432/madp',
  };
  const read = (p: string) => {
    if (!(p in files)) throw new Error('ENOENT');
    return files[p]!;
  };
  it('reads X from the file X_FILE names, without the trailing newline', () => {
    const out = withSecretFiles(
      { AUTH_JWT_SECRET_FILE: '/run/secrets/jwt', DATABASE_URL_FILE: '/run/secrets/db', PORT: '4000' },
      read,
    );
    expect(out).toEqual({
      AUTH_JWT_SECRET: 'j'.repeat(40),
      DATABASE_URL: 'postgres://u:p@postgres:5432/madp',
      PORT: '4000',
    });
  });
  it('refuses both X and X_FILE, and a file that cannot be read', () => {
    expect(() =>
      withSecretFiles({ AUTH_JWT_SECRET: 'x', AUTH_JWT_SECRET_FILE: '/run/secrets/jwt' }, read),
    ).toThrow(/not both/);
    expect(() => withSecretFiles({ PII_HASH_KEY_FILE: '/run/secrets/missing' }, read)).toThrow(
      /can't be read/,
    );
  });
  it('is used by loadApiEnv', () => {
    const { AUTH_JWT_SECRET, ...rest } = base;
    expect(() => loadApiEnv({ ...rest, AUTH_JWT_SECRET_FILE: '/nonexistent/madp-test-secret' })).toThrow(
      /can't be read/,
    );
  });
});
