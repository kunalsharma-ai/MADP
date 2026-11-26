'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

function refresh() {
  // Panels appear on most screens (brand switcher, chips, filters), so refresh the whole console.
  revalidatePath('/', 'layout');
}

export async function createPanelAction(input: Record<string, unknown>) {
  const r = await api<{ code: string }>('/panels', { method: 'POST', json: input });
  refresh();
  return r;
}

export async function updatePanelAction(code: string, input: Record<string, unknown>) {
  const r = await api<{ code: string }>(`/panels/${encodeURIComponent(code)}`, { method: 'PUT', json: input });
  refresh();
  return r;
}

export async function panelStateAction(code: string, action: 'archive' | 'restore' | 'delete', reason: string) {
  const r =
    action === 'delete'
      ? await api(`/panels/${encodeURIComponent(code)}`, { method: 'DELETE', json: { reason } })
      : await api(`/panels/${encodeURIComponent(code)}/${action}`, { method: 'POST', json: { reason } });
  refresh();
  return r;
}
