import 'server-only';
import { cache } from 'react';
import type { PanelInfo } from '@madp/contracts';
import { api } from '@/lib/api';

/** The active panels (T2O, MFR, MHO and any added on the Panels screen), once per request. */
export const getPanels = cache(async (): Promise<PanelInfo[]> => {
  const { panels } = await api<{ panels: PanelInfo[] }>('/panels');
  return panels.filter((p) => p.status === 'active');
});
