import { describe, expect, it } from 'vitest';
import { isDatabaseNotReady } from './migrate.js';

describe('isDatabaseNotReady', () => {
  it('retries while Postgres is starting or its service name is not resolvable yet', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', '57P03']) {
      expect(isDatabaseNotReady(Object.assign(new Error(code), { code }))).toBe(true);
    }
  });
  it('does not retry real errors such as a wrong password or a missing database', () => {
    expect(isDatabaseNotReady(Object.assign(new Error('auth'), { code: '28P01' }))).toBe(false);
    expect(isDatabaseNotReady(Object.assign(new Error('db'), { code: '3D000' }))).toBe(false);
    expect(isDatabaseNotReady(new Error('plain'))).toBe(false);
    expect(isDatabaseNotReady(null)).toBe(false);
  });
});
