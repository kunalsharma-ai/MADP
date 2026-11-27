'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { attempt } from '@/lib/attempt';

export async function changeConnectionAction(panel: string, input: Record<string, unknown>) {
  return attempt(async () => {
    const r = await api<{ status: 'applied' | 'pending'; fields: string[] }>(
      `/panel-connections/${encodeURIComponent(panel)}`,
      { method: 'PUT', json: input },
    );
    revalidatePath('/panel-connections');
    revalidatePath('/connectors');
    return r;
  });
}

export async function decideConnectionAction(
  panel: string,
  input: { decision: 'approve' | 'reject'; reason: string; code: string },
) {
  return attempt(async () => {
    const r = await api<{ status: string }>(`/panel-connections/${encodeURIComponent(panel)}/decision`, {
      method: 'POST',
      json: input,
    });
    revalidatePath('/panel-connections');
    revalidatePath('/connectors');
    return r;
  });
}

export async function testConnectionAction(
  panel: string,
  input: { syncBaseUrl?: string; syncToken?: string },
) {
  return attempt(async () => {
    const r = await api<{ ok: boolean; message: string }>(
      `/panel-connections/${encodeURIComponent(panel)}/test`,
      {
        method: 'POST',
        json: input,
      },
    );
    revalidatePath('/panel-connections');
    return r;
  });
}

/** Reads the panel's GET /api/v1/contract and saves what it declares (MADP Panel API Contract). */
export async function checkContractAction(panel: string) {
  return attempt(async () => {
    const r = await api<{ ok: boolean; message: string; version: string | null; capabilities: string[] }>(
      `/panel-connections/${encodeURIComponent(panel)}/contract-check`,
      { method: 'POST', json: {} },
    );
    revalidatePath('/panel-connections');
    return r;
  });
}

/** Runs the read-only conformance kit against the panel. */
export async function runConformanceAction(panel: string) {
  return attempt(async () => {
    const r = await api<{ conformant: boolean; counts: Record<string, number> }>(
      `/panel-connections/${encodeURIComponent(panel)}/conformance`,
      { method: 'POST', json: {} },
    );
    revalidatePath('/panel-connections');
    return r;
  });
}
