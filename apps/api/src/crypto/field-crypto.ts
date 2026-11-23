import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import { API_ENV } from '../common/tokens.js';

const KEY_ID = 'k1';

/**
 * Field-level encryption for PII (AES-256-GCM, random 96-bit IV) and keyed hashing for matching.
 * Ciphertext format: `<keyId>.<iv>.<tag>.<data>` (base64url), so keys can be rotated by adding a new id.
 */
@Injectable()
export class FieldCrypto {
  private readonly key: Buffer;
  private readonly hashKey: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.key = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');
    this.hashKey = env.PII_HASH_KEY;
  }

  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [KEY_ID, iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  decrypt(token: string | null | undefined): string | null {
    if (!token) return null;
    const [kid, iv, tag, data] = token.split('.');
    if (kid !== KEY_ID || !iv || !tag || data === undefined) throw new Error('Unknown ciphertext format');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  }

  /** Keyed hash of a normalised e-mail, used for exact-match identity candidates. */
  emailHash(email: string | null | undefined): string | null {
    const n = normaliseEmail(email);
    return n ? createHmac('sha256', this.hashKey).update(`email:${n}`).digest('hex') : null;
  }
}

export function normaliseEmail(email: string | null | undefined): string | null {
  const e = String(email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** "demo.member.00042@example.invalid" -> "de***@ex***.invalid" */
export function maskEmail(email: string | null | undefined): string | null {
  const n = normaliseEmail(email);
  if (!n) return null;
  const [user = '', domain = ''] = n.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${user.slice(0, 2)}***@${host.slice(0, 2)}***${tld}`;
}
