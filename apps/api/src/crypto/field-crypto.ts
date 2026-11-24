import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import { API_ENV } from '../common/tokens.js';

/**
 * Field-level encryption for PII (AES-256-GCM, random 96-bit IV) and keyed hashing for matching.
 * Ciphertext format: `<keyId>.<iv>.<tag>.<data>` (base64url). Rotation: add the new key to FIELD_ENCRYPTION_KEYS,
 * make it FIELD_ENCRYPTION_ACTIVE_KEY, run `rotate-field-keys` to re-encrypt, then retire the old key.
 */
@Injectable()
export class FieldCrypto {
  private readonly keys: Map<string, Buffer>;
  readonly activeKeyId: string;
  private readonly hashKey: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.keys = new Map([
      ['k1', Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64')],
      ...Object.entries(env.FIELD_ENCRYPTION_KEYS ?? {}).map(([id, k]) => [id, Buffer.from(k, 'base64')] as const),
    ]);
    this.activeKeyId = env.FIELD_ENCRYPTION_ACTIVE_KEY ?? 'k1';
    if (!this.keys.has(this.activeKeyId)) throw new Error(`Unknown active field key ${this.activeKeyId}`);
    this.hashKey = env.PII_HASH_KEY;
  }

  /** Key id a ciphertext was made with, or null for an empty value. */
  keyIdOf(token: string | null | undefined): string | null {
    return token ? (token.split('.')[0] ?? null) : null;
  }

  /** Re-encrypts with the active key when the value uses another key; returns the same token otherwise. */
  reencrypt(token: string | null | undefined): string | null {
    if (!token) return null;
    return this.keyIdOf(token) === this.activeKeyId ? token : this.encrypt(this.decrypt(token));
  }

  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [
      this.activeKeyId,
      iv.toString('base64url'),
      c.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join('.');
  }

  decrypt(token: string | null | undefined): string | null {
    if (!token) return null;
    const [kid, iv, tag, data] = token.split('.');
    const key = kid ? this.keys.get(kid) : undefined;
    if (!key || !iv || !tag || data === undefined)
      throw new Error(key ? 'Unknown ciphertext format' : `No field key ${kid} is configured`);
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
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
  const e = String(email ?? '')
    .trim()
    .toLowerCase();
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
