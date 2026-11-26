'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { PanelInfo } from '@madp/contracts';

const PanelsContext = createContext<PanelInfo[]>([]);

/** Gives client components the active panels the layout loaded. */
export function PanelsProvider({ panels, children }: { panels: PanelInfo[]; children: ReactNode }) {
  return <PanelsContext.Provider value={panels}>{children}</PanelsContext.Provider>;
}

export function usePanels(): PanelInfo[] {
  return useContext(PanelsContext);
}
