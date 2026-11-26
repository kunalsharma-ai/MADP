'use server';

import { revalidatePath } from 'next/cache';
import type { ChannelName, ChannelSave, RemindersSave } from '@madp/contracts';
import { api } from '@/lib/api';
import { attempt } from '@/lib/attempt';

const PATH = '/communications/reminders';

export async function saveRemindersAction(body: RemindersSave) {
  return attempt(async () => {
    const r = await api('/panel/reminders', { method: 'PUT', json: body });
    revalidatePath(PATH);
    return r;
  });
}

export async function previewRemindersAction() {
  return attempt(() =>
    api<{
      checked: number;
      due: number;
      byCase: Record<string, number>;
      skipped: Record<string, number>;
      limited: boolean;
      switchOn: boolean;
    }>('/panel/reminders/preview', { method: 'POST', json: {} }),
  );
}

export async function saveChannelAction(channel: ChannelName, body: ChannelSave) {
  return attempt(async () => {
    const r = await api(`/panel/channels/${channel}`, { method: 'PUT', json: body });
    revalidatePath(PATH);
    return r;
  });
}

export async function checkChannelAction(channel: ChannelName) {
  return attempt(async () => {
    const r = await api<{ ok: boolean; message: string }>(`/panel/channels/${channel}/check`, {
      method: 'POST',
      json: {},
    });
    revalidatePath(PATH);
    return r;
  });
}

export async function removeChannelAction(channel: ChannelName, reason: string) {
  return attempt(async () => {
    const r = await api<{ removed: boolean }>(`/panel/channels/${channel}/remove`, {
      method: 'POST',
      json: { reason },
    });
    revalidatePath(PATH);
    return r;
  });
}
