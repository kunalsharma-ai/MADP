import { z } from 'zod';
import { PanelCode } from './panels.js';

/** What a connector can actually do against its source, as verified (or not) during the audit. */
export const ConnectorCapability = z.enum([
  'questions.read',
  'options.read',
  'questionnaires.read',
  'respondents.read',
  'respondents.pagination',
  'respondents.updatedSince',
  'answers.read',
  'answers.updatedSince',
  'consent.read',
  'deletions.read',
  'rewards.read',
  'webhooks',
  'questions.write',
  'serviceAccountAuth',
]);
export type ConnectorCapability = z.infer<typeof ConnectorCapability>;

export const CapabilityStatus = z.enum(['verified', 'partial', 'missing', 'unknown']);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

export interface CapabilityFinding {
  capability: ConnectorCapability;
  status: CapabilityStatus;
  /** File/line or endpoint that supports the finding. */
  evidence: string;
}

export const ConnectorMode = z.enum(['demo', 'snapshot', 'live']);
export type ConnectorMode = z.infer<typeof ConnectorMode>;

export const ConnectorHealthState = z.enum(['healthy', 'degraded', 'down', 'disabled']);

export const ConnectorHealth = z.object({
  panel: PanelCode,
  mode: ConnectorMode,
  state: ConnectorHealthState,
  checkedAt: z.string().datetime(),
  latencyMs: z.number().nullable(),
  message: z.string(),
});
export type ConnectorHealth = z.infer<typeof ConnectorHealth>;
