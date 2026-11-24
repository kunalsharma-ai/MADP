'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

/**
 * Server actions for step 4: switches, rewards, engagement, teens and data requests. Every change that moves money,
 * a member or a request carries the admin's reason; MADP's API checks permissions and writes the audit trail.
 */
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
async function run<T>(fn: () => Promise<T>, path: string): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath(path);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Something went wrong' };
  }
}
const e = encodeURIComponent;

/** One reasoned change, picked by `op`. */
export type ReasonOp =
  | {
      op: 'switch';
      key: string;
      /** null removes a segment/country row so the wider setting applies again */
      on: boolean | null;
      segment?: string;
      country?: string;
      value?: number;
    }
  | { op: 'redemption'; id: string; status: 'approved' | 'fulfilled' | 'rejected' }
  | { op: 'draw'; id: string; action: 'run' | 'cancel' }
  | { op: 'offer-end'; id: string }
  | { op: 'teen-revoke'; id: string }
  | { op: 'teen-graduate'; id: string; segment?: 'b2c' | 'b2b' }
  | { op: 'teen-close'; id: string }
  | { op: 'teen-registration'; id: string; action: 'approve' | 'cancel' | 'renew' }
  | { op: 'data-request'; id: string; status: 'approved' | 'rejected' | 'done' };

export async function reasonAction(o: ReasonOp, reason: string) {
  switch (o.op) {
    case 'switch':
      return run(
        () =>
          api(`/panel/switches/${e(o.key)}`, {
            method: 'PUT',
            json: {
              on: o.on,
              reason,
              ...(o.segment ? { segment: o.segment } : {}),
              ...(o.country ? { country: o.country } : {}),
              ...(o.value !== undefined ? { value: o.value } : {}),
            },
          }),
        '/switches',
      );
    case 'redemption':
      return run(
        () =>
          api(`/panel/redemptions/${e(o.id)}/decision`, {
            method: 'POST',
            json: { status: o.status, reason },
          }),
        '/rewards',
      );
    case 'draw':
      return run(
        () => api(`/panel/draws/${e(o.id)}/${o.action}`, { method: 'POST', json: { reason } }),
        '/rewards',
      );
    case 'offer-end':
      return run(() => api(`/panel/offers/${e(o.id)}/end`, { method: 'POST', json: { reason } }), '/rewards');
    case 'teen-revoke':
      return run(
        () => api(`/panel/teens/${e(o.id)}/revoke-links`, { method: 'POST', json: { reason } }),
        '/teens',
      );
    case 'teen-graduate':
      return run(
        () =>
          api(`/panel/teens/${e(o.id)}/graduate`, {
            method: 'POST',
            json: { dryRun: false, reason, segment: o.segment ?? 'b2c' },
          }),
        '/teens',
      );
    case 'teen-close':
      return run(() => api(`/panel/teens/${e(o.id)}/close`, { method: 'POST', json: { reason } }), '/teens');
    case 'teen-registration':
      return run(
        () => api(`/panel/teens/registrations/${e(o.id)}/${o.action}`, { method: 'POST', json: { reason } }),
        '/teens/registrations',
      );
    case 'data-request':
      return run(
        () =>
          api(`/panel/data-requests/${e(o.id)}/decision`, {
            method: 'POST',
            json: { status: o.status, reason },
          }),
        '/data-requests',
      );
  }
}

export async function graduatePreviewAction(teen: string) {
  return run(
    () =>
      api<{ age: number; guardianLinksToStop: number; rewardRequestsToCancel: number }>(
        `/panel/teens/${e(teen)}/graduate`,
        {
          method: 'POST',
          json: { dryRun: true },
        },
      ),
    '/teens',
  );
}
export async function catalogueCreateAction(item: Record<string, unknown>) {
  return run(() => api('/panel/rewards/catalogue', { method: 'POST', json: item }), '/rewards');
}
export async function offerCreateAction(offer: Record<string, unknown>) {
  return run(() => api('/panel/offers', { method: 'POST', json: offer }), '/rewards');
}
export async function taskCreateAction(task: Record<string, unknown>) {
  return run(() => api('/panel/engagement/tasks', { method: 'POST', json: task }), '/engagement');
}
export async function storyCreateAction(story: Record<string, unknown>) {
  return run(() => api('/panel/engagement/stories', { method: 'POST', json: story }), '/engagement');
}
export async function storyPublishAction(story: string, published: boolean) {
  return run(
    () => api(`/panel/engagement/stories/${e(story)}`, { method: 'PUT', json: { published } }),
    '/engagement',
  );
}
export async function ideaAction(entry: string, status: 'approved' | 'rejected') {
  return run(
    () => api(`/panel/engagement/ideas/${e(entry)}`, { method: 'POST', json: { status } }),
    '/engagement',
  );
}

/** Create or replace a segment's prize machine (MFR#56). */
export async function prizeMachineSaveAction(segment: string, body: Record<string, unknown>) {
  return run(
    () => api(`/panel/prize-machines/${e(segment)}`, { method: 'PUT', json: body }),
    '/prize-machines',
  );
}
