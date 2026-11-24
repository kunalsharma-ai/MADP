import { z } from 'zod';
import { AudienceCategory, PanelCode } from './panels.js';

/**
 * Engagement studio (Milestone 4, part 1). Each panel keeps its own brand, sender, templates, consents and
 * history. Runs are dry runs: they record who would get a message, when, and why others would not. Sending stays
 * off until a provider is configured and the owner approves it.
 */
export const CampaignKind = z.enum([
  'welcome',
  'newsletter',
  'birthday',
  'festival',
  'reengagement',
  'profile_recovery',
  'survey_reminder',
  'service',
]);
export type CampaignKind = z.infer<typeof CampaignKind>;

/**
 * Why a message may be sent, per kind. `marketing` needs an e-mail marketing consent on record; `onboarding` needs
 * the panel's terms to be accepted; `service` (necessary account or legal notices) needs neither, skips frequency
 * caps, and is kept for messages that have a separate justification.
 */
export const KIND_BASIS: Record<CampaignKind, 'marketing' | 'onboarding' | 'service'> = {
  welcome: 'onboarding',
  newsletter: 'marketing',
  birthday: 'marketing',
  festival: 'marketing',
  reengagement: 'marketing',
  profile_recovery: 'onboarding',
  survey_reminder: 'onboarding',
  service: 'service',
};
/** Consent purpose each basis needs. The panels do not export an e-mail marketing consent yet. */
export const BASIS_CONSENT: Record<'marketing' | 'onboarding' | 'service', string | null> = {
  marketing: 'email_marketing',
  onboarding: 'terms',
  service: null,
};

/**
 * Values a template may use, as `{{name}}` or `{{ name | default: "fallback" }}` (the fallback is used when the value
 * is empty). Everything is HTML-escaped when rendered.
 */
export const TEMPLATE_PLACEHOLDERS = [
  'firstName',
  'email',
  'panelName',
  'unsubscribeUrl',
  'preferencesUrl',
  'profileUrl',
  'accountUrl',
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export const SUPPRESSION_REASONS = [
  'membership_not_active',
  'minor_excluded',
  'no_consent',
  'no_email',
  'opted_out',
  'bounced_or_complained',
  'already_sent',
  'frequency_cap_week',
  'frequency_cap_month',
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export interface BrandKit {
  displayName: string;
  /** Sender, footer and privacy link come from Brands & settings (brand_setting). Anything not given yet is null. */
  senderName: string | null;
  senderAddress: string | null;
  legalFooter: string | null;
  privacyUrl: string | null;
  /** Served by the admin app (apps/admin/public/brands). */
  logo: string | null;
  /** True when the sender, legal footer, privacy link and logo are all set. */
  confirmed: boolean;
}
/** Fallback before Brands & settings is read: display names only, nothing confirmed. */
export const BRAND_KITS: Record<PanelCode, BrandKit> = {
  t2o: { displayName: 'Turn2Opinion', senderName: null, senderAddress: null, legalFooter: null, privacyUrl: null, logo: null, confirmed: false },
  mfr: { displayName: 'MyFrequentRewards', senderName: null, senderAddress: null, legalFooter: null, privacyUrl: null, logo: null, confirmed: false },
  mho: { displayName: 'MyHealthOpinions', senderName: null, senderAddress: null, legalFooter: null, privacyUrl: null, logo: null, confirmed: false },
};
/** What a brand kit still lacks, in words for the screens. */
export function brandKitGaps(k: BrandKit): string[] {
  const gaps: string[] = [];
  if (!k.senderAddress) gaps.push('sender address');
  if (!k.legalFooter) gaps.push('legal footer');
  if (!k.privacyUrl) gaps.push('privacy policy link');
  if (!k.logo) gaps.push('logo');
  return gaps;
}

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lower-case letters, digits and dashes');

export const TemplateCreate = z.object({
  panel: PanelCode,
  key: slug,
  name: z.string().trim().min(2).max(120),
  kind: CampaignKind,
});
export type TemplateCreate = z.infer<typeof TemplateCreate>;

export const TemplateVersionCreate = z.object({
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default('en'),
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(50_000),
});
export type TemplateVersionCreate = z.infer<typeof TemplateVersionCreate>;

export const TemplateReview = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional(),
});
export type TemplateReview = z.infer<typeof TemplateReview>;

export const CampaignAudience = z.object({
  categories: z.array(AudienceCategory).max(5).optional(),
  countries: z.array(z.string().regex(/^[a-z]{2}$/)).max(50).optional(),
});
export type CampaignAudience = z.infer<typeof CampaignAudience>;

export const CampaignCreate = z.object({
  name: z.string().trim().min(2).max(120),
  templateVersionId: z.string().uuid(),
  audience: CampaignAudience.default({}),
});
export type CampaignCreate = z.infer<typeof CampaignCreate>;

export const CampaignDecision = z.object({ decision: z.enum(['approve', 'pause', 'resume', 'archive']) });
export type CampaignDecision = z.infer<typeof CampaignDecision>;

export const CampaignRunRequest = z.object({ dryRun: z.boolean().default(true) });
export type CampaignRunRequest = z.infer<typeof CampaignRunRequest>;

export const FatiguePolicyUpdate = z
  .object({
    maxPerWeek: z.number().int().min(0).max(50),
    maxPerMonth: z.number().int().min(0).max(200),
    quietStartHour: z.number().int().min(0).max(23),
    quietEndHour: z.number().int().min(0).max(23),
    bands: z.object({ high: z.number().int().min(1).max(1000), medium: z.number().int().min(0).max(1000) }),
  })
  .refine((p) => p.maxPerWeek <= p.maxPerMonth, 'maxPerWeek cannot be above maxPerMonth')
  .refine((p) => p.bands.medium < p.bands.high, 'the medium band must start below the high band');
export type FatiguePolicyUpdate = z.infer<typeof FatiguePolicyUpdate>;

export const TimelineQuery = z.object({
  panel: PanelCode.optional(),
  includeDryRuns: z.enum(['true', 'false']).default('true'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type TimelineQuery = z.infer<typeof TimelineQuery>;
