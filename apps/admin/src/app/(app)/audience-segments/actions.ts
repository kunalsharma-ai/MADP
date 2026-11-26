'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

function refresh() {
  // Segment names appear in filters and chips across the console.
  revalidatePath('/', 'layout');
}

export async function createSegmentAction(input: Record<string, unknown>) {
  const r = await api<{ key: string }>('/audience-segments', { method: 'POST', json: input });
  refresh();
  return r;
}

export async function updateSegmentAction(key: string, input: Record<string, unknown>) {
  const r = await api(`/audience-segments/${encodeURIComponent(key)}`, { method: 'PUT', json: input });
  refresh();
  return r;
}

export async function segmentStateAction(key: string, action: 'archive' | 'restore' | 'delete', reason: string) {
  const r =
    action === 'delete'
      ? await api(`/audience-segments/${encodeURIComponent(key)}`, { method: 'DELETE', json: { reason } })
      : await api(`/audience-segments/${encodeURIComponent(key)}/${action}`, { method: 'POST', json: { reason } });
  refresh();
  return r;
}

export async function addRuleAction(input: Record<string, unknown>) {
  const r = await api('/audience-segments/rules', { method: 'POST', json: input });
  refresh();
  return r;
}

export async function ruleStateAction(id: string, action: 'archive' | 'restore' | 'delete', reason: string) {
  const r =
    action === 'delete'
      ? await api(`/audience-segments/rules/${encodeURIComponent(id)}`, { method: 'DELETE', json: { reason } })
      : await api(`/audience-segments/rules/${encodeURIComponent(id)}/${action}`, { method: 'POST', json: { reason } });
  refresh();
  return r;
}
