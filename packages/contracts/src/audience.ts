import { z } from 'zod';
import { AudienceCategory, PanelCode } from './panels.js';

/** Every count MADP returns says whether it came from DEMO fixtures or live, authorised source data. */
export const DataMode = z.enum(['demo', 'live']);
export type DataMode = z.infer<typeof DataMode>;

export const CountsRequest = z.object({
  panels: z.array(PanelCode).optional(),
  categories: z.array(AudienceCategory).optional(),
  countries: z.array(z.string().length(2)).optional(),
  verifiedEmailOnly: z.boolean().optional(),
});
export type CountsRequest = z.infer<typeof CountsRequest>;

export const CountCell = z.object({
  key: z.string(),
  /** null when suppressed by the minimum cell threshold. */
  value: z.number().int().nullable(),
  suppressed: z.boolean(),
});
export type CountCell = z.infer<typeof CountCell>;

export const CountsResponse = z.object({
  dataMode: DataMode,
  /** Distinct master persons matching the filter. Never the sum of memberships. */
  uniquePeople: z.number().int(),
  /** Panel accounts matching the filter (a person in two panels counts twice here). */
  panelMemberships: z.number().int(),
  /** Category memberships matching the filter (a person in two categories counts twice here). */
  categoryMemberships: z.number().int(),
  byPanel: z.array(CountCell),
  byCategory: z.array(CountCell),
  byCountry: z.array(CountCell),
  minimumCellSize: z.number().int(),
  computedAt: z.string().datetime(),
  /** Oldest successful sync among panels that contributed, so stale counts are visible. */
  freshestSourceSyncAt: z.string().datetime().nullable(),
  oldestSourceSyncAt: z.string().datetime().nullable(),
});
export type CountsResponse = z.infer<typeof CountsResponse>;
