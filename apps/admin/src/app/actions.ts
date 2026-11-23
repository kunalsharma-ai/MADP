'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, apiPublic, SESSION_COOKIE } from '@/lib/api';

const cookieOpts = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60,
};

export async function signIn(_: unknown, form: FormData): Promise<{ error?: string }> {
  const totp = String(form.get('totp') ?? '').trim();
  const r = await apiPublic<{ token?: string; mfaSetupRequired?: boolean; message?: string }>('/auth/login', {
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
    ...(totp ? { totp } : {}),
  });
  if (!r.ok || !r.body.token)
    return {
      error:
        r.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Those details did not match. Check your e-mail, password and authenticator code.',
    };
  (await cookies()).set(SESSION_COOKIE, r.body.token, cookieOpts);
  redirect(r.body.mfaSetupRequired ? '/mfa' : '/');
}

export async function confirmMfa(_: unknown, form: FormData): Promise<{ error?: string }> {
  try {
    const r = await api<{ token: string }>('/auth/mfa/confirm', {
      method: 'POST',
      json: { code: String(form.get('code') ?? '').trim() },
    });
    (await cookies()).set(SESSION_COOKIE, r.token, cookieOpts);
  } catch {
    return { error: 'That code did not work. Codes change every 30 seconds — try the current one.' };
  }
  redirect('/');
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function runImport(panel: string, dryRun: boolean) {
  const r = await api<{ status: string; jobId: string; error?: string; counts: Record<string, unknown> }>(
    `/connectors/${panel}/import`,
    { method: 'POST', json: { dryRun } },
  );
  revalidatePath('/connectors');
  return r;
}

export async function decideMapping(
  id: string,
  decision: 'approve' | 'reject' | 'needs_info',
  attributeKey?: string,
  notes?: string,
  valueMap?: Record<string, string>,
) {
  const map = valueMap && Object.keys(valueMap).length ? valueMap : undefined;
  await api(`/mappings/${id}/decision`, {
    method: 'POST',
    json: {
      decision,
      ...(attributeKey ? { attributeKey } : {}),
      ...(notes ? { notes } : {}),
      ...(map ? { valueMap: map } : {}),
    },
  });
  revalidatePath('/mappings');
}

/** All options of one question version, for the value map editor. */
export async function questionOptions(panel: string, sourceQuestionId: string, version: number) {
  const r = await api<{ versions: { version: number; options: { value: string; label: string }[] }[] }>(
    `/questions/${encodeURIComponent(panel)}/${encodeURIComponent(sourceQuestionId)}`,
  );
  // Options repeat once per parent value (cascading questions); the value map needs each value once.
  const seen = new Set<string>();
  return (r.versions.find((v) => v.version === version)?.options ?? []).filter(
    (o) => !seen.has(o.value) && seen.add(o.value),
  );
}

export async function retryDeadLetters(panel: string) {
  const r = await api<{ attempted: number; resolved: number; stillOpen: number }>(
    `/connectors/${encodeURIComponent(panel)}/dead-letters/retry`,
    { method: 'POST', json: {} },
  );
  revalidatePath('/connectors');
  return r;
}
