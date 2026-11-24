import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const SESSION_COOKIE = 'madp_session';
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
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
