import { describe, expect, it } from 'vitest';
import { FieldCrypto, maskEmail } from './field-crypto.js';

const env = {
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PII_HASH_KEY: 'k'.repeat(32),
} as never;

describe('FieldCrypto', () => {
  const c = new FieldCrypto(env);
  it('round-trips and never repeats ciphertext', () => {
    const a = c.encrypt('person@example.invalid');
    const b = c.encrypt('person@example.invalid');
    expect(a).not.toEqual(b);
    expect(c.decrypt(a)).toBe('person@example.invalid');
  });
  it('detects tampering', () => {
    const t = c.encrypt('x')!.split('.');
    t[3] = Buffer.from('y').toString('base64url');
    expect(() => c.decrypt(t.join('.'))).toThrow();
  });
  it('hashes e-mails case-insensitively and rejects junk', () => {
    expect(c.emailHash(' A@B.co ')).toBe(c.emailHash('a@b.co'));
    expect(c.emailHash('not-an-email')).toBeNull();
  });
  it('masks e-mails', () => {
    expect(maskEmail('demo.member.00042@example.invalid')).toBe('de***@ex***.invalid');
  });
  it('rotates: old values stay readable and re-encrypt to the active key', () => {
    const old = c.encrypt('rotate@example.invalid')!;
    const k2 = Buffer.alloc(32, 9).toString('base64');
    const next = new FieldCrypto({ ...(env as object), FIELD_ENCRYPTION_KEYS: { k2 }, FIELD_ENCRYPTION_ACTIVE_KEY: 'k2' } as never);
    expect(next.decrypt(old)).toBe('rotate@example.invalid');
    const moved = next.reencrypt(old)!;
    expect(next.keyIdOf(moved)).toBe('k2');
    expect(next.reencrypt(moved)).toBe(moved);
    expect(next.decrypt(moved)).toBe('rotate@example.invalid');
    // Once k1 is retired, a value still on k1 fails loudly instead of returning garbage.
    const retired = new FieldCrypto({ FIELD_ENCRYPTION_KEY: k2, PII_HASH_KEY: 'k'.repeat(32) } as never);
    expect(() => retired.decrypt(moved)).toThrow(/No field key k2/);
  });
});
