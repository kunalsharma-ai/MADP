import { z } from 'zod';

/** A base URL for a panel backend. https only; the API also allows http on a local address outside production. */
export const PanelBaseUrl = z
  .string()
  .trim()
  .url()
  .max(400)
  .regex(/^https?:\/\//, 'an http(s) address')
  .transform((u) => u.replace(/\/+$/, ''));

/** A token or secret typed into the console. Never returned; only its last four characters are shown. */
const Secret = z.string().trim().min(16, 'at least 16 characters').max(4096);

/**
 * A change on Panel connections. Omitted fields stay as they are; `null` clears the console value, so the
 * environment value (if any) applies again. `code` is the admin's current authenticator code.
 */
export const PanelConnectionChange = z
  .object({
    syncBaseUrl: PanelBaseUrl.nullable().optional(),
    syncToken: Secret.nullable().optional(),
    adminBaseUrl: PanelBaseUrl.nullable().optional(),
    adminSecret: Secret.nullable().optional(),
    syncIntervalMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    /** Turning this on is the owner's approval to read this panel's production personal data. */
    liveApproved: z.boolean().optional(),
    reason: z.string().trim().min(5).max(500),
    code: z.string().regex(/^\d{6}$/, 'the 6-digit code from your authenticator app'),
  })
  .strict();
export type PanelConnectionChange = z.infer<typeof PanelConnectionChange>;

export const PANEL_CONNECTION_FIELDS = [
  'syncBaseUrl',
  'syncToken',
  'adminBaseUrl',
  'adminSecret',
  'syncIntervalMinutes',
  'liveApproved',
] as const;
export type PanelConnectionField = (typeof PANEL_CONNECTION_FIELDS)[number];

/** Approve or reject someone else's pending change. */
export const PanelConnectionDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(5).max(500),
    code: z.string().regex(/^\d{6}$/, 'the 6-digit code from your authenticator app'),
  })
  .strict();
export type PanelConnectionDecision = z.infer<typeof PanelConnectionDecision>;

/** Test settings before saving them. Omitted values use what is saved now. */
export const PanelConnectionTest = z
  .object({
    syncBaseUrl: PanelBaseUrl.optional(),
    syncToken: Secret.optional(),
  })
  .strict();
export type PanelConnectionTest = z.infer<typeof PanelConnectionTest>;

export type ConfigSource = 'console' | 'env' | 'none';

/** What the screen shows for one panel. Holds no token or secret. */
export interface PanelConnectionView {
  panel: string;
  name: string;
  syncBaseUrl: { value: string | null; source: ConfigSource };
  syncToken: { set: boolean; hint: string | null; source: ConfigSource };
  adminBaseUrl: { value: string | null; source: ConfigSource };
  adminSecret: { set: boolean; hint: string | null; source: ConfigSource };
  syncIntervalMinutes: { value: number; source: ConfigSource };
  liveApproved: { value: boolean; source: ConfigSource; by: string | null; at: string | null };
  dataMode: 'demo' | 'live';
  reason: string;
  pending: { fields: string[]; by: string; byName: string | null; at: string; reason: string | null } | null;
  lastTest: { at: string; ok: boolean; message: string | null } | null;
  /** The MADP Panel API Contract: what the panel offers, and its last conformance run. */
  contract: PanelContractView;
  /** True when the caller may change this panel's connection. */
  canChange: boolean;
}

/** One conformance check as stored and shown. Never holds records. */
export interface ConformanceCheckView {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
  capability?: string;
}

export interface PanelContractView {
  /** `discovered`: the panel's own answer. `assumed`: no passing check yet, so the shared backend's capabilities. */
  source: 'discovered' | 'assumed';
  version: string | null;
  implementation: string | null;
  capabilities: string[];
  brands: string[];
  lastCheck: { at: string; ok: boolean; message: string | null } | null;
  conformance: {
    at: string;
    conformant: boolean;
    counts: { pass: number; fail: number; warn: number; skip: number };
    personalDataProbed: boolean;
    results: ConformanceCheckView[];
  } | null;
}
