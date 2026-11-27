import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed requests (the `/api/v1/admin` scheme of the shared panel backend, MFR#44 and MFR#62, as implemented in
 * kunalsharma-ai/MFR Project/api/app/admin/auth.js).
 *
 * Headers on every signed call:
 * - `x-madp-timestamp`: Unix seconds. The panel refuses one further than 300 s from its clock.
 * - `x-madp-nonce`: 32 to 64 hex characters, new for every call. The panel accepts each nonce once (keep them 10 minutes).
 * - `x-madp-origin`: the brand hostname. The panel filters every query on it. Never the Host header.
 * - `x-madp-actor`: the MADP admin's id (a UUID), for the panel's own log.
 * - `x-madp-signature`: hex HMAC-SHA256 with the shared secret over
 *   `${timestamp}\n${nonce}\n${METHOD}\n${path+query}\n${origin}\n${actor}\n${sha256 hex of the raw body}`.
 *
 * A bad or stale signature answers 401, a brand the backend does not serve 403, and a replayed nonce 409, all with
 * `{status:'error', code:'admin_auth', message}`. MADP never retries them.
 * MADP never follows a redirect on a signed call, so a panel API must not redirect.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const NONCE_PATTERN = /^[0-9a-f]{32,64}$/;

export interface SignInput {
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  origin: string;
  actor: string;
  body: string;
}

export function canonicalString(p: SignInput): string {
  const bodyHash = createHash('sha256').update(p.body).digest('hex');
  return `${p.timestamp}\n${p.nonce}\n${p.method.toUpperCase()}\n${p.path}\n${p.origin}\n${p.actor}\n${bodyHash}`;
}

export function sign(secret: string, p: SignInput): string {
  return createHmac('sha256', secret).update(canonicalString(p)).digest('hex');
}

/** The headers of one signed call. `now` is in milliseconds. */
export function signedHeaders(
  secret: string,
  p: Omit<SignInput, 'timestamp' | 'nonce'> & { now?: number; nonce?: string },
): Record<string, string> {
  const timestamp = String(Math.floor((p.now ?? Date.now()) / 1000));
  const nonce = p.nonce ?? randomBytes(16).toString('hex');
  return {
    'x-madp-timestamp': timestamp,
    'x-madp-nonce': nonce,
    'x-madp-origin': p.origin,
    'x-madp-actor': p.actor,
    'x-madp-signature': sign(secret, { ...p, timestamp, nonce }),
  };
}

export type VerifyResult =
  | { ok: true; origin: string; actor: string }
  | { ok: false; status: 401 | 409; code: string; message: string };

/**
 * The panel side of the check, for implementers and the reference panel. `seen` must remember nonces for at least
 * twice the tolerance; it returns true when the nonce was already used.
 */
export function verifySigned(p: {
  secret: string;
  headers: Record<string, string | undefined>;
  method: string;
  path: string;
  body: string;
  now?: number;
  seen: (nonce: string) => boolean;
}): VerifyResult {
  const h = (k: string) => p.headers[k] ?? p.headers[k.toLowerCase()];
  const ts = h('x-madp-timestamp');
  const nonce = h('x-madp-nonce');
  const origin = h('x-madp-origin');
  const actor = h('x-madp-actor');
  const sig = h('x-madp-signature');
  if (!ts || !nonce || !origin || actor === undefined || !sig)
    return { ok: false, status: 401, code: 'admin_auth', message: 'Missing signed headers' };
  const skew = Math.abs((p.now ?? Date.now()) / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > SIGNATURE_TOLERANCE_SECONDS)
    return { ok: false, status: 401, code: 'admin_auth', message: 'Timestamp outside the allowed window' };
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, status: 401, code: 'admin_auth', message: 'Bad nonce' };
  const want = Buffer.from(
    sign(p.secret, { timestamp: ts, nonce, method: p.method, path: p.path, origin, actor, body: p.body }),
  );
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got))
    return { ok: false, status: 401, code: 'admin_auth', message: 'Signature does not match' };
  if (p.seen(nonce))
    return {
      ok: false,
      status: 409,
      code: 'admin_auth',
      message: 'This signed request was already used (replayed)',
    };
  return { ok: true, origin, actor };
}
