import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SERVICE_TOLERANCE_SECONDS = 300;

export const bodyHash = (raw: Buffer | string) => createHash('sha256').update(raw).digest('hex');

/** `v1=<hex>` over `<ts>.<nonce>.<METHOD>.<path>.<sha256 of body>`. Exported for clients and tests. */
export function signServiceRequest(secret: string, ts: string, nonce: string, method: string, path: string, rawBody: Buffer | string) {
  const mac = createHmac('sha256', secret)
    .update(`${ts}.${nonce}.${method.toUpperCase()}.${path}.${bodyHash(rawBody)}`)
    .digest('hex');
  return `v1=${mac}`;
}

export function verifyServiceSignature(o: {
  secret: string;
  header: string | undefined;
  ts: string | undefined;
  nonce: string | undefined;
  method: string;
  path: string;
  rawBody: Buffer;
  nowSeconds: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!o.ts || !/^\d{9,11}$/.test(o.ts)) return { ok: false, reason: 'missing_timestamp' };
  if (Math.abs(o.nowSeconds - Number(o.ts)) > SERVICE_TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' };
  if (!o.nonce || !/^[A-Za-z0-9_-]{8,64}$/.test(o.nonce)) return { ok: false, reason: 'bad_nonce' };
  if (!o.header || !/^v1=[0-9a-f]{64}$/.test(o.header)) return { ok: false, reason: 'bad_signature_format' };
  const want = Buffer.from(signServiceRequest(o.secret, o.ts, o.nonce, o.method, o.path, o.rawBody).slice(3), 'hex');
  const got = Buffer.from(o.header.slice(3), 'hex');
  return got.length === want.length && timingSafeEqual(got, want) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
