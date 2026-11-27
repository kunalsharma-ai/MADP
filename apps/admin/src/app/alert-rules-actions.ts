'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { AlertRuleInput, AlertRules } from '@madp/contracts';
import { api } from '@/lib/api';
import { attempt } from '@/lib/attempt';

/** Polled by the header: which of my rules are firing now. */
export async function alertRulesAction(): Promise<AlertRules | null> {
  try {
    return await api<AlertRules>('/alert-rules');
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}

export async function saveAlertRuleAction(id: string | null, body: AlertRuleInput) {
  return attempt(async () => {
    const r = await api(id ? `/alert-rules/${id}` : '/alert-rules', {
      method: id ? 'PUT' : 'POST',
      json: body,
    });
    revalidatePath('/alert-rules');
    return r;
  });
}

export async function muteAlertRuleAction(id: string, hours: number) {
  return attempt(async () => {
    const r = await api(`/alert-rules/${id}/mute`, { method: 'POST', json: { hours } });
    revalidatePath('/alert-rules');
    return r;
  });
}

export async function removeAlertRuleAction(id: string) {
  return attempt(async () => {
    const r = await api(`/alert-rules/${id}/remove`, { method: 'POST', json: {} });
    revalidatePath('/alert-rules');
    return r;
  });
}
