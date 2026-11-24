'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

/** Verify or decline one expert verification request. MADP's API checks quality.manage and audits the decision. */
export async function expertDecisionAction(
  id: string,
  decision: 'verified' | 'declined',
  reason: string,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api(`/panel/experts/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      json: { decision, reason, ...(note ? { note } : {}) },
    });
    revalidatePath('/experts');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Something went wrong' };
  }
}
