'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

/** Server actions for the members, question bank and profiles screens. Errors come back as text for a toast. */
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
const id = (s: string) => encodeURIComponent(s);

export async function memberEditAction(member: string, patch: Record<string, string>, reason: string) {
  return run(
    () => api(`/panel/members/${id(member)}`, { method: 'PUT', json: { ...patch, reason } }),
    `/members/${member}`,
  );
}
export async function memberStatusAction(member: string, action: string, reason: string) {
  return run(
    () => api(`/panel/members/${id(member)}/status`, { method: 'POST', json: { action, reason } }),
    `/members/${member}`,
  );
}
export async function memberSegmentAction(member: string, category: string, reason: string) {
  return run(
    () => api(`/panel/members/${id(member)}/segment`, { method: 'POST', json: { category, reason } }),
    `/members/${member}`,
  );
}
export async function memberUnmaskAction(member: string, fields: string[], reason: string) {
  return run(() =>
    api<{ fields: string[]; values: Record<string, unknown> }>(`/panel/members/${id(member)}/unmask`, {
      method: 'POST',
      json: { fields, reason },
    }),
  );
}
export async function archiveRunAction(dryRun: boolean, reason?: string) {
  return run(
    () =>
      api<{ dryRun: boolean; months: number; checked: number; archived: number; activityUpdated: number }>(
        '/panel/members/archive-run',
        { method: 'POST', json: { dryRun, ...(reason ? { reason } : {}) } },
      ),
    dryRun ? undefined : '/members',
  );
}
export async function restoreAction(ids: string[], reason: string) {
  return run(
    () =>
      api<{ asked: number; restored: number }>('/panel/members/restore', {
        method: 'POST',
        json: { ids, reason },
      }),
    '/members',
  );
}

export async function questionSaveAction(name: string, patch: Record<string, unknown>, isNew: boolean) {
  return run(
    () =>
      isNew
        ? api('/panel/questions', { method: 'POST', json: { name, ...patch } })
        : api(`/panel/questions/${id(name)}`, { method: 'PUT', json: patch }),
    `/question-bank/${name}`,
  );
}
export async function optionsSaveAction(name: string, options: Record<string, unknown>[], reason?: string) {
  return run(
    () =>
      api<{ added: number; retired: number }>(`/panel/questions/${id(name)}/options`, {
        method: 'PUT',
        json: { options, ...(reason ? { reason } : {}) },
      }),
    `/question-bank/${name}`,
  );
}
export async function importAction(file: unknown, write: boolean) {
  return run(
    () =>
      api<Record<string, unknown>>(`/panel/qb/import?dryRun=${write ? 0 : 1}`, {
        method: 'POST',
        json: file,
      }),
    write ? '/question-bank' : undefined,
  );
}
export async function profileSaveAction(profile: string, patch: Record<string, unknown>) {
  return run(() => api(`/panel/profiles/${id(profile)}`, { method: 'PUT', json: patch }), '/profiles');
}
