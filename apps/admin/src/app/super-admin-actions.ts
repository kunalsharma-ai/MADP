'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { api, BRAND_COOKIE } from '@/lib/api';

/** Brand switcher. The API re-checks the brand against the admin's grants on every call. */
export async function setBrand(brand: string) {
  // Any panel code or "all"; the API checks the brand against the admin's grants on every call.
  if (brand !== 'all' && !/^[a-z][a-z0-9_]{1,15}$/.test(brand)) return;
  (await cookies()).set(BRAND_COOKIE, brand, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  revalidatePath('/', 'layout');
}

export async function createAdminAction(input: {
  email: string;
  displayName: string;
  grants: { role: string; brands: string[] | null }[];
}) {
  const r = await api<{ id: string; oneTimePassword: string }>('/admins', { method: 'POST', json: input });
  revalidatePath('/admins');
  return r;
}

export async function updateAdminAction(
  id: string,
  input: { isActive?: boolean; grants?: { role: string; brands: string[] | null }[]; reason: string },
) {
  await api(`/admins/${encodeURIComponent(id)}`, { method: 'PUT', json: input });
  revalidatePath('/admins');
}

/** Issue #94: a new one-time password for another admin, shown once. */
export async function resetAdminPasswordAction(id: string, input: { resetMfa: boolean; reason: string }) {
  const r = await api<{ id: string; oneTimePassword: string }>(
    `/admins/${encodeURIComponent(id)}/reset-password`,
    { method: 'POST', json: input },
  );
  revalidatePath('/admins');
  return r;
}

export async function saveRoleAction(
  key: string,
  input: { name: string; description: string; permissions: string[]; reason?: string },
  isNew: boolean,
) {
  if (isNew) await api('/roles', { method: 'POST', json: { key, ...input } });
  else await api(`/roles/${encodeURIComponent(key)}`, { method: 'PUT', json: input });
  revalidatePath('/admins');
}

export async function saveBrandSettingsAction(panel: string, input: Record<string, unknown>) {
  await api(`/brands/${encodeURIComponent(panel)}/settings`, { method: 'PUT', json: input });
  revalidatePath('/brands');
}

export async function verifyAuditAction() {
  return api<{ ok: boolean; checked: number; firstBrokenId: number | null; problem: string | null }>(
    '/audit/verify',
  );
}

/** Issue #94: change your own password. Returns a message instead of throwing, so the form can show it. */
export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ error?: string }> {
  try {
    await api('/auth/password', { method: 'POST', json: input });
    return {};
  } catch (e) {
    unstable_rethrow(e);
    const m = (e as Error).message;
    return { error: /current password/i.test(m) ? 'Your current password is not right.' : m };
  }
}
