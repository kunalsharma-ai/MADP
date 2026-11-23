import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './index.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/madp', MONGODB_URL: 'mongodb://localhost:27017', AUTH_JWT_SECRET: 'x'.repeat(32), FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), PII_HASH_KEY: 'h'.repeat(32) };

describe('loadApiEnv', () => {
  it('defaults to no live source access', () => {
    expect(loadApiEnv(base).LIVE_SOURCE_APPROVED_PANELS).toEqual([]);
  });
  it('parses approved panels and rejects unknown ones', () => {
    expect(loadApiEnv({ ...base, LIVE_SOURCE_APPROVED_PANELS: 'T2O, mho' }).LIVE_SOURCE_APPROVED_PANELS).toEqual(['t2o', 'mho']);
    expect(() => loadApiEnv({ ...base, LIVE_SOURCE_APPROVED_PANELS: 'abc' })).toThrow();
  });
  it('requires MFA unless explicitly disabled', () => {
    expect(loadApiEnv(base).REQUIRE_MFA).toBe(true);
    expect(loadApiEnv({ ...base, REQUIRE_MFA: 'false' }).REQUIRE_MFA).toBe(false);
  });
  it('requires a strong signing secret', () => {
    expect(() => loadApiEnv({ ...base, AUTH_JWT_SECRET: 'short' })).toThrow(/AUTH_JWT_SECRET/);
  });
});
