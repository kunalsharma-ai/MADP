/**
 * Masks personal data before it goes into an audit entry's before/after values. Keys are matched by name, so
 * callers can pass whole records; ids, counts, statuses and settings pass through unchanged.
 */
const SECRET = /pass(word)?|token|secret|totp|api[_-]?key|hash$/i;
const PERSONAL =
  /e-?mail|phone|mobile|whats_?app|address|street|postcode|zip|pin_?code|dob|birth|first_?name|last_?name|full_?name|account(_?number)?|iban|upi|paypal|ifsc|card|ssn|aadhaar|pan_?number/i;

export function maskValue(v: unknown): unknown {
  if (v == null) return v;
  const s = String(v);
  if (s.includes('@')) {
    const [u, d] = s.split('@');
    return `${u!.slice(0, 1)}***@${d}`;
  }
  return s.length <= 4 ? '***' : `${s.slice(0, 1)}***${s.slice(-2)}`;
}

export function maskPersonal(v: unknown, depth = 0): unknown {
  if (v == null || depth > 8) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => maskPersonal(x, depth + 1));
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET.test(k)) out[k] = '[redacted]';
      else if (PERSONAL.test(k) && (typeof x === 'string' || typeof x === 'number')) out[k] = maskValue(x);
      else out[k] = maskPersonal(x, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string' && v.length > 2000) return `${v.slice(0, 2000)}…`;
  return v;
}

/** Only the fields that changed, for before/after values. */
export function changed<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a, any: Object.keys(a).length > 0 };
}
