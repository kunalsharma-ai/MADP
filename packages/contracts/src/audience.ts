import { z } from 'zod';
import { AudienceCategory, PanelCode } from './panels.js';

/** Every count MADP returns says whether it came from DEMO fixtures or live, authorised source data. */
export const DataMode = z.enum(['demo', 'live']);
export type DataMode = z.infer<typeof DataMode>;

/**
 * Filter on a canonical attribute. Matches a person when any approved source question mapped to the attribute
 * holds one of the canonical values. Values are canonical (after the mapping's value map), not source codes.
 */
export const AttributeFilter = z.object({
  key: z.string().min(1).max(100),
  values: z.array(z.string().min(1).max(200)).min(1).max(50),
});
export type AttributeFilter = z.infer<typeof AttributeFilter>;

export const CountsRequest = z.object({
  panels: z.array(PanelCode).optional(),
  categories: z.array(AudienceCategory).optional(),
  countries: z.array(z.string().length(2)).optional(),
  verifiedEmailOnly: z.boolean().optional(),
  /** AND across filters, OR within one filter's values. Special-category attributes need health.sensitive.read. */
  attributes: z.array(AttributeFilter).max(10).optional(),
  /** Required when any attribute filter is special-category. */
  purpose: z.lazy(() => HealthAccessPurpose).optional(),
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
  /** How each attribute filter was resolved, so a zero count from an unmapped attribute is visible. */
  attributeFilters: z
    .array(
      z.object({
        key: z.string(),
        sensitivity: z.enum(['standard', 'personal', 'special_category']),
        approvedMappings: z.number().int(),
        panels: z.array(PanelCode),
      }),
    )
    .optional(),
});
export type CountsResponse = z.infer<typeof CountsResponse>;

/**
 * Why someone needs to see health or other special-category data. Viewing MHO health answers, or counting with a
 * special-category filter, needs `health.sensitive.read` *and* one of these purposes, which is kept in the audit log.
 */
export const HealthAccessPurpose = z.enum([
  'participant_support',
  'data_quality_review',
  'privacy_request',
  'study_feasibility',
]);
export type HealthAccessPurpose = z.infer<typeof HealthAccessPurpose>;
export const HEALTH_ACCESS_PURPOSE_LABELS: Record<HealthAccessPurpose, string> = {
  participant_support: 'Helping this participant with a support request',
  data_quality_review: 'Checking data quality',
  privacy_request: 'Handling a privacy or deletion request',
  study_feasibility: 'Sizing a study (counts only)',
};

/**
 * Geography explorer (screens 2 and 3): country, then state or province, then city. Unique people per place, with
 * the panel split; small cells are suppressed. The place is the person's, chosen by source precedence.
 */
export const GeoRequest = CountsRequest.omit({ countries: true }).extend({
  country: z
    .string()
    .regex(/^[a-zA-Z]{2}$/)
    .transform((c) => c.toLowerCase())
    .optional(),
  state: z.string().trim().min(1).max(120).optional(),
}).refine((g) => !g.state || g.country, { message: 'Pick a country before a state' });
export type GeoRequest = z.infer<typeof GeoRequest>;

export interface GeoRow {
  key: string;
  /** null when suppressed by the minimum cell size. */
  uniquePeople: number | null;
  byPanel: Record<string, number | null>;
  suppressed: boolean;
}
export interface GeoResponse {
  dataMode: DataMode;
  level: 'country' | 'state' | 'city';
  country: string | null;
  state: string | null;
  uniquePeople: number;
  rows: GeoRow[];
  /** Time zones members gave, most common first (country and state levels). */
  timezones: { key: string; people: number | null }[];
  minimumCellSize: number;
  computedAt: string;
}

/** Five-category segmentation and overlap (screen 4): who is in which panels and which categories at once. */
export interface OverlapResponse {
  dataMode: DataMode;
  uniquePeople: number;
  /** e.g. "t2o", "mfr+t2o": people whose active memberships are exactly these panels. */
  panelCombinations: { panels: string[]; people: number | null; suppressed: boolean }[];
  /** People in both categories (the diagonal is people in the category). */
  categoryMatrix: { a: string; b: string; people: number | null; suppressed: boolean }[];
  minimumCellSize: number;
  computedAt: string;
}
