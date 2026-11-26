'use server';

import { revalidatePath } from 'next/cache';
import type { NetworkUploadResult } from '@madp/contracts';
import { api } from '@/lib/api';
import { attempt } from '@/lib/attempt';

export async function uploadAction(
  panel: string,
  input: { kind: string; format: 'csv' | 'xlsx'; file: string; dryRun: boolean; reason: string },
) {
  return attempt(async () => {
    const r = await api<NetworkUploadResult>(`/networks/${encodeURIComponent(panel)}/upload`, {
      method: 'POST',
      json: input,
    });
    if (!input.dryRun) revalidatePath('/networks');
    return r;
  });
}

export async function newPushKeyAction(panel: string, input: { reason: string; code: string }) {
  return attempt(async () => {
    const r = await api<{ key: string; hint: string }>(`/networks/${encodeURIComponent(panel)}/push-key`, {
      method: 'POST',
      json: input,
    });
    revalidatePath('/networks');
    return r;
  });
}

export async function revokePushKeyAction(panel: string, input: { reason: string; code: string }) {
  return attempt(async () => {
    const r = await api(`/networks/${encodeURIComponent(panel)}/push-key`, { method: 'DELETE', json: input });
    revalidatePath('/networks');
    return r;
  });
}
