import type { PanelInfo } from '@madp/contracts';

const BUILT_IN: Record<string, { name: string; shortName: string }> = {
  t2o: { name: 'Turn2Opinion', shortName: 'T2O' },
  mfr: { name: 'MyFrequentRewards', shortName: 'MFR' },
  mho: { name: 'MyHealthOpinions', shortName: 'MHO' },
};

/** A panel's short name (T2O), from the loaded list; works for a panel added later or since archived. */
export function panelShort(code: string, panels?: readonly PanelInfo[]): string {
  return panels?.find((p) => p.code === code)?.shortName ?? BUILT_IN[code]?.shortName ?? code.toUpperCase();
}

export function panelName(code: string, panels?: readonly PanelInfo[]): string {
  return panels?.find((p) => p.code === code)?.name ?? BUILT_IN[code]?.name ?? code.toUpperCase();
}
