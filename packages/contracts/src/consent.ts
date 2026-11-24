import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * Consent and preference center (spec §11, screen 14). Panels own consent: MADP shows what they report, keeps the
 * history as evidence, and records channel opt-outs that a member asks MADP for directly. MADP never grants
 * consent; a `resumed` preference only lifts an earlier MADP opt-out.
 */
export const CONTACT_CHANNELS = ['email', 'sms', 'push', 'whatsapp', 'all'] as const;
export const ContactChannel = z.enum(CONTACT_CHANNELS);
export type ContactChannel = z.infer<typeof ContactChannel>;

export const PREFERENCE_SOURCES = ['member_request', 'privacy_request', 'support_ticket'] as const;

export const ContactPreferenceCreate = z.object({
  panel: PanelCode,
  channel: ContactChannel,
  status: z.enum(['opted_out', 'resumed']),
  source: z.enum(PREFERENCE_SOURCES),
  /** Where the request came from, e.g. a ticket number. No personal data. */
  reason: z.string().trim().min(3).max(300),
});
export type ContactPreferenceCreate = z.infer<typeof ContactPreferenceCreate>;

export const ConsentQuery = z.object({
  panel: PanelCode.optional(),
  purpose: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConsentQuery = z.infer<typeof ConsentQuery>;
