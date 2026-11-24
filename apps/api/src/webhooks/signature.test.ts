import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from './signature.js';

const s1 = 'a'.repeat(32);
const s2 = 'b'.repeat(32);
const body = Buffer.from('{"type":"member.changed"}');
const base = { eventId: 'evt-1', rawBody: body, nowSeconds: 1_800_000_000, toleranceSeconds: 300 };
const ts = String(base.nowSeconds);

describe('webhook signatures', () => {
  it('accepts a valid signature from any current secret (rotation)', () => {
    expect(verifyWebhook({ ...base, secrets: [s1, s2], header: signWebhook(s2, ts, 'evt-1', body), timestamp: ts })).toEqual({
      ok: true,
      secretIndex: 1,
    });
    const both = `${signWebhook('c'.repeat(32), ts, 'evt-1', body)}, ${signWebhook(s1, ts, 'evt-1', body)}`;
    expect(verifyWebhook({ ...base, secrets: [s1], header: both, timestamp: ts }).ok).toBe(true);
  });
  it('rejects a changed body, event id or timestamp', () => {
    const sig = signWebhook(s1, ts, 'evt-1', body);
    expect(verifyWebhook({ ...base, secrets: [s1], header: sig, timestamp: ts, rawBody: Buffer.from('{}') })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyWebhook({ ...base, secrets: [s1], header: sig, timestamp: ts, eventId: 'evt-2' }).ok).toBe(false);
    expect(verifyWebhook({ ...base, secrets: [s1], header: sig, timestamp: String(base.nowSeconds - 1) }).ok).toBe(false);
  });
  it('rejects replays outside the tolerance and malformed headers', () => {
    const old = String(base.nowSeconds - 301);
    expect(verifyWebhook({ ...base, secrets: [s1], header: signWebhook(s1, old, 'evt-1', body), timestamp: old })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
    expect(verifyWebhook({ ...base, secrets: [s1], header: undefined, timestamp: ts }).ok).toBe(false);
    expect(verifyWebhook({ ...base, secrets: [s1], header: 'sha256=abc', timestamp: ts })).toEqual({
      ok: false,
      reason: 'bad_signature_format',
    });
  });
});
