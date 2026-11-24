'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { DraftSpec } from '@madp/contracts';
import { api, ApiError } from '@/lib/api';

/** Server actions for the questionnaire builder. Errors come back as text for a toast. */
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
async function run<T>(fn: () => Promise<T>, path?: string): Promise<Result<T>> {
  try {
    const data = await fn();
    if (path) revalidatePath(path);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Something went wrong' };
  }
}
const at = (id: string) => `/questionnaires/${encodeURIComponent(id)}`;

export async function startDraftAction(form: FormData) {
  let id: string;
  try {
    const note = String(form.get('note') ?? '').trim();
    const d = await api<{ id: string }>('/questionnaires/drafts', {
      method: 'POST',
      json: { category: String(form.get('category')), slug: String(form.get('slug')), ...(note ? { note } : {}) },
    });
    id = d.id;
  } catch (e) {
    redirect(`/questionnaires?error=${encodeURIComponent(e instanceof ApiError ? e.message : 'Could not start the draft')}`);
  }
  redirect(at(id));
}
export async function saveDraftAction(id: string, spec: DraftSpec, note?: string) {
  return run(() => api(`/questionnaires/drafts/${encodeURIComponent(id)}`, { method: 'PUT', json: { spec, note } }), at(id));
}
export async function moveDraftAction(id: string, action: 'submit' | 'discard' | 'apply') {
  return run(
    () => api<{ ok?: boolean }>(`/questionnaires/drafts/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
    at(id),
  );
}
export async function reviewDraftAction(id: string, decision: 'approve' | 'reject', note?: string) {
  return run(
    () => api(`/questionnaires/drafts/${encodeURIComponent(id)}/review`, { method: 'POST', json: { decision, note } }),
    at(id),
  );
}
