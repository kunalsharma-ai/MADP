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

// ---- step 3a: segments, audiences, surveys, points, quality; question bank versions -----------------------------
export async function segmentSaveAction(name: string, patch: Record<string, unknown>, reason: string) {
  return run(
    () => api(`/panel/segments/${id(name)}`, { method: 'PUT', json: { ...patch, reason } }),
    '/segments',
  );
}
export async function audienceCountAction(filter: Record<string, unknown>) {
  return run(() =>
    api<{ count: number; bySegment: Record<string, number> }>('/panel/audiences/count', {
      method: 'POST',
      json: { filter },
    }),
  );
}
export async function audienceSaveAction(name: string, description: string, filter: Record<string, unknown>) {
  return run(
    () =>
      api<{ id: string; count: number }>('/panel/audiences', {
        method: 'POST',
        json: { name, description, filter },
      }),
    '/segments',
  );
}
export async function surveyCreateAction(survey: Record<string, unknown>) {
  return run(() => api<{ id: string }>('/panel/surveys', { method: 'POST', json: survey }), '/surveys');
}
export async function surveyUpdateAction(survey: string, patch: Record<string, unknown>) {
  return run(() => api(`/panel/surveys/${id(survey)}`, { method: 'PUT', json: patch }), `/surveys/${survey}`);
}
export async function surveyStatusAction(survey: string, status: string, reason?: string) {
  return run(
    () =>
      api(`/panel/surveys/${id(survey)}/status`, {
        method: 'POST',
        json: { status, ...(reason ? { reason } : {}) },
      }),
    `/surveys/${survey}`,
  );
}
export async function surveyInviteAction(
  survey: string,
  dryRun: boolean,
  audienceId?: string,
  reason?: string,
) {
  return run(
    () =>
      api<{ dryRun: boolean; wouldInvite?: number; invited?: number; emailSent: boolean }>(
        `/panel/surveys/${id(survey)}/invite`,
        {
          method: 'POST',
          json: { dryRun, ...(audienceId ? { audienceId } : {}), ...(reason ? { reason } : {}) },
        },
      ),
    dryRun ? undefined : `/surveys/${survey}`,
  );
}
export async function surveyFeasibilityAction(survey: string, audienceId?: string) {
  return run(() =>
    api<{ eligible: number; alreadyInvited: number; wouldInvite: number }>(
      `/panel/surveys/${id(survey)}/feasibility`,
      {
        method: 'POST',
        json: audienceId ? { audienceId } : {},
      },
    ),
  );
}
export async function reconcileAction(survey: string, approve: string[], reject: string[], reason: string) {
  return run(
    () =>
      api<{ approved: number; rejected: number; skipped: number }>(`/panel/surveys/${id(survey)}/reconcile`, {
        method: 'POST',
        json: { approve, reject, reason },
      }),
    `/surveys/${survey}`,
  );
}
export async function pointsAdjustAction(member: string, points: number, reasonCode: string, note: string) {
  return run(
    () =>
      api<{
        adjustment: { status: string };
        before: { available: number };
        after: { available: number };
        fourEyesAt: number;
      }>(`/panel/members/${id(member)}/points`, { method: 'POST', json: { points, reasonCode, note } }),
    `/members/${member}`,
  );
}
export async function pointsDecideAction(adjustment: string, decision: 'approve' | 'reject', note?: string) {
  return run(
    () =>
      api(`/panel/points/approvals/${id(adjustment)}`, {
        method: 'POST',
        json: { decision, ...(note ? { note } : {}) },
      }),
    '/points',
  );
}
export async function holdReleaseAction(hold: string, reason: string) {
  return run(
    () => api(`/panel/points/holds/${id(hold)}/release`, { method: 'POST', json: { reason } }),
    '/points',
  );
}
export async function qualityChangeAction(member: string, rule: string, delta: number, note: string) {
  return run(
    () =>
      api<{ before: { score: number }; after: { score: number } }>(`/panel/members/${id(member)}/quality`, {
        method: 'POST',
        json: { rule, delta, note },
      }),
    `/members/${member}`,
  );
}
export async function versionCreateAction(note: string) {
  return run(
    () => api<{ number: number }>('/panel/qb/versions', { method: 'POST', json: note ? { note } : {} }),
    '/question-bank',
  );
}
export async function versionMoveAction(n: number, action: 'review' | 'publish' | 'discard') {
  return run(() => api(`/panel/qb/versions/${n}/${action}`, { method: 'POST' }), '/question-bank');
}

// ---- step 3b: tickets, portal messages, help centre ---------------------------------------------------------------
export async function ticketReplyAction(ticket: string, message: string, internal: boolean) {
  return run(
    () =>
      api<{ status: string; emailSent: boolean }>(`/panel/tickets/${id(ticket)}/reply`, {
        method: 'POST',
        json: { message, internal },
      }),
    `/tickets/${ticket}`,
  );
}
export async function ticketStatusAction(ticket: string, status: string) {
  return run(
    () => api(`/panel/tickets/${id(ticket)}/status`, { method: 'POST', json: { status } }),
    `/tickets/${ticket}`,
  );
}
export async function ticketUpdateAction(ticket: string, patch: Record<string, string>) {
  return run(() => api(`/panel/tickets/${id(ticket)}`, { method: 'PUT', json: patch }), `/tickets/${ticket}`);
}
export async function messageCreateAction(m: Record<string, unknown>) {
  return run(() => api<{ id: string }>('/panel/messages', { method: 'POST', json: m }), '/messages');
}
export async function messagePreviewAction(message: string, audienceId?: string) {
  return run(() =>
    api<{ recipients: number; teens: number }>(`/panel/messages/${id(message)}/preview`, {
      method: 'POST',
      json: audienceId ? { audienceId } : {},
    }),
  );
}
export async function messageSendAction(message: string, reason: string, audienceId?: string) {
  return run(
    () =>
      api<{ recipients: number }>(`/panel/messages/${id(message)}/send`, {
        method: 'POST',
        json: { reason, ...(audienceId ? { audienceId } : {}) },
      }),
    '/messages',
  );
}
export async function messageWithdrawAction(message: string, reason: string) {
  return run(
    () => api(`/panel/messages/${id(message)}/withdraw`, { method: 'POST', json: { reason } }),
    '/messages',
  );
}
export async function helpSaveAction(entry: string | null, data: Record<string, unknown>) {
  return run(
    () =>
      entry
        ? api(`/panel/help/${id(entry)}`, { method: 'PUT', json: data })
        : api<{ id: string }>('/panel/help', { method: 'POST', json: data }),
    '/help-centre',
  );
}
export async function helpStatusAction(entry: string, status: string) {
  return run(
    () => api(`/panel/help/${id(entry)}/status`, { method: 'POST', json: { status } }),
    '/help-centre',
  );
}
