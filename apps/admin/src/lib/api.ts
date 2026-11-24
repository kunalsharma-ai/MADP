import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const SESSION_COOKIE = 'madp_session';
/** Brand picked in the brand switcher. The API checks it against the admin's grants on every request. */
export const BRAND_COOKIE = 'madp_brand';
const BRANDS = new Set(['t2o', 'mfr', 'mho', 'all']);

/**
 * The brand this request works in: the switcher's choice when the admin may use it, otherwise every brand side by
 * side for those allowed, otherwise the first brand granted. Read once per request (React cache).
 */
export const currentBrand = cache(async (): Promise<string | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${API}/auth/me`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const me = (await res.json()) as { brands: string[]; permissions: string[] };
  const allowAll = me.permissions.includes('dashboard.read');
  const picked = jar.get(BRAND_COOKIE)?.value;
  if (picked && BRANDS.has(picked) && (picked === 'all' ? allowAll : me.brands.includes(picked))) return picked;
  return allowAll ? 'all' : (me.brands[0] ?? null);
});
const API = process.env.MADP_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side call to the MADP API with the admin's session token (kept in an httpOnly cookie). */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const brand = await currentBrand();
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(brand ? { 'x-madp-brand': brand } : {}),
      ...init.headers,
    },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
  if (res.status === 401) redirect('/login');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { message?: string; problems?: string[] };
    const msg = b.message ?? res.statusText;
    throw new ApiError(res.status, b.problems?.length ? `${msg}: ${b.problems.join('; ')}` : msg);
  }
  return body as T;
}

export async function apiPublic<T>(
  path: string,
  json: unknown,
): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(json),
  });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/** Raw server-side GET (CSV downloads), with the same session and brand headers. */
export async function apiRaw(path: string): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const brand = await currentBrand();
  return fetch(`${API}${path}`, {
    cache: 'no-store',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(brand ? { 'x-madp-brand': brand } : {}),
    },
  });
}
