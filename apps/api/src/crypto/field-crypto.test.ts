import { describe, expect, it } from 'vitest';
import { FieldCrypto, maskEmail } from './field-crypto.js';

const env = { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), PII_HASH_KEY: 'k'.repeat(32) } as never;

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
});
