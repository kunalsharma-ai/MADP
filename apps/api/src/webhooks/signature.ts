import { createHmac, timingSafeEqual } from 'node:crypto';

/** `v1=<hex>` signature over `<timestamp>.<event id>.<raw body>`. Exported for panels and tests. */
export function signWebhook(secret: string, timestamp: string, eventId: string, rawBody: Buffer | string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${eventId}.`).update(rawBody).digest('hex');
  return `v1=${mac}`;
}

export type VerifyResult = { ok: true; secretIndex: number } | { ok: false; reason: string };

export function verifyWebhook(opts: {
  secrets: string[];
  header: string | undefined;
  timestamp: string | undefined;
  eventId: string;
  rawBody: Buffer;
  nowSeconds: number;
  toleranceSeconds: number;
}): VerifyResult {
  if (!opts.header) return { ok: false, reason: 'missing_signature' };
  if (!opts.timestamp || !/^\d{9,11}$/.test(opts.timestamp)) return { ok: false, reason: 'missing_timestamp' };
  if (Math.abs(opts.nowSeconds - Number(opts.timestamp)) > opts.toleranceSeconds)
    return { ok: false, reason: 'stale_timestamp' };
  const given = opts.header
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^v1=[0-9a-f]{64}$/.test(s))
    .map((s) => Buffer.from(s.slice(3), 'hex'));
  if (!given.length) return { ok: false, reason: 'bad_signature_format' };
  for (const [i, secret] of opts.secrets.entries()) {
    const want = Buffer.from(signWebhook(secret, opts.timestamp, opts.eventId, opts.rawBody).slice(3), 'hex');
    if (given.some((g) => g.length === want.length && timingSafeEqual(g, want))) return { ok: true, secretIndex: i };
  }
  return { ok: false, reason: 'bad_signature' };
}
