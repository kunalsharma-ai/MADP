'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

export async function changeConnectionAction(panel: string, input: Record<string, unknown>) {
  const r = await api<{ status: 'applied' | 'pending'; fields: string[] }>(
    `/panel-connections/${encodeURIComponent(panel)}`,
    { method: 'PUT', json: input },
  );
  revalidatePath('/panel-connections');
  revalidatePath('/connectors');
  return r;
}

export async function decideConnectionAction(
  panel: string,
  input: { decision: 'approve' | 'reject'; reason: string; code: string },
) {
  const r = await api<{ status: string }>(`/panel-connections/${encodeURIComponent(panel)}/decision`, {
    method: 'POST',
    json: input,
  });
  revalidatePath('/panel-connections');
  revalidatePath('/connectors');
  return r;
}

export async function testConnectionAction(
  panel: string,
  input: { syncBaseUrl?: string; syncToken?: string },
) {
  const r = await api<{ ok: boolean; message: string }>(
    `/panel-connections/${encodeURIComponent(panel)}/test`,
    {
      method: 'POST',
      json: input,
    },
  );
  revalidatePath('/panel-connections');
  return r;
}
