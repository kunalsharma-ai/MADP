import { z } from 'zod';
import { CampaignKind } from './engagement.js';
import { AudienceCategory, PanelCode } from './panels.js';

/**
 * Mailer library: the panels' own email templates (Liquid), imported from the owner's mailer packs. MADP shows them,
 * previews them with the designers' sample data and maps every merge field to where its value comes from. It sends
 * nothing: system emails are sent by the panel at the event, and only the campaign kinds below can become MADP campaigns.
 */
export const MERGE_FIELD_SOURCES = [
  'panel_account',
  'panel_one_time',
  'panel_survey',
  'panel_referral',
  'panel_support',
  'madp_member',
  'madp_profile',
  'madp_consent',
  'madp_brand_links',
] as const;
export type MergeFieldSource = (typeof MERGE_FIELD_SOURCES)[number];

export const MERGE_FIELD_SOURCE_LABELS: Record<MergeFieldSource, string> = {
  panel_account: 'Panel account',
  panel_one_time: 'Panel, at send time (one-time code or link)',
  panel_survey: 'Panel survey',
  panel_referral: 'Panel referral',
  panel_support: 'Panel support ticket',
  madp_member: 'MADP member record',
  madp_profile: 'MADP profile freshness',
  madp_consent: 'MADP consent record',
  madp_brand_links: 'MADP brand settings',
};

export interface MergeFieldInfo {
  source: MergeFieldSource;
  label: string;
  /** The MADP value that fills it, when MADP holds one. */
  madpField: string | null;
  /** Personal data that must never appear in a preview, export or log. */
  personal: boolean;
}

/** Where each merge field used by the packs comes from. A field missing here is shown as unmapped. */
export const MERGE_FIELDS: Record<string, MergeFieldInfo> = {
  'user.name.first': { source: 'panel_account', label: 'Member first name', madpField: 'firstName', personal: true },
  'user.fullName': { source: 'panel_account', label: 'Member full name (the inviter, on the referral invitation)', madpField: null, personal: true },
  'user.name': { source: 'panel_support', label: 'Ticket requester name (support templates only)', madpField: null, personal: true },
  'user.mail': { source: 'panel_account', label: 'Member email address', madpField: null, personal: true },
  'user.email': { source: 'panel_support', label: 'Ticket requester email (support templates only)', madpField: null, personal: true },
  'user._id': { source: 'panel_account', label: 'Panel member id', madpField: 'sourceMemberId', personal: false },
  'user.memberId': { source: 'panel_account', label: 'Panel member id', madpField: 'sourceMemberId', personal: false },
  'user.origin': { source: 'madp_brand_links', label: 'Brand website host', madpField: 'brandOrigin', personal: false },
  'user.parent.name.first': { source: 'panel_account', label: 'Parent or guardian first name', madpField: null, personal: true },
  'user.parent.relation': { source: 'panel_account', label: 'Parent or guardian relation', madpField: null, personal: true },
  token: { source: 'panel_one_time', label: 'One-time link token', madpField: null, personal: false },
  'otp.code': { source: 'panel_one_time', label: 'One-time code', madpField: null, personal: false },
  email: { source: 'panel_one_time', label: 'New email address (change-email templates)', madpField: null, personal: true },
  'survey.name': { source: 'panel_survey', label: 'Survey name', madpField: null, personal: false },
  'survey.points': { source: 'panel_survey', label: 'Survey reward points', madpField: null, personal: false },
  'survey.time': { source: 'panel_survey', label: 'Survey length in minutes', madpField: null, personal: false },
  'survey.link': { source: 'panel_survey', label: 'Survey link', madpField: null, personal: false },
  'ref.link': { source: 'panel_referral', label: 'Referral link', madpField: null, personal: false },
  'data.ticketNo': { source: 'panel_support', label: 'Ticket number', madpField: null, personal: false },
  'data.subject': { source: 'panel_support', label: 'Ticket subject', madpField: null, personal: false },
  'reply.ticketNo': { source: 'panel_support', label: 'Ticket number', madpField: null, personal: false },
  'reply.message': { source: 'panel_support', label: 'Reply text', madpField: null, personal: false },
  'repliedBy.fullName': { source: 'panel_support', label: 'Name of the team member who replied', madpField: null, personal: false },
  'member.first_name': { source: 'madp_member', label: 'Member first name', madpField: 'firstName', personal: true },
  'member.email': { source: 'madp_member', label: 'Member email address', madpField: null, personal: true },
  'member.member_id': { source: 'madp_member', label: 'Panel member id', madpField: 'sourceMemberId', personal: false },
  'profile.completed_count': { source: 'madp_profile', label: 'Profiles completed', madpField: 'profilesCompleted', personal: false },
  'profile.total_count': { source: 'madp_profile', label: 'Profiles available', madpField: 'profilesTotal', personal: false },
  'profile.next_name': { source: 'madp_profile', label: 'Next profile to complete', madpField: 'nextProfile', personal: false },
  'consent.version': { source: 'madp_consent', label: 'Consent form version', madpField: 'consentVersion', personal: false },
  'consent.signedAt': { source: 'madp_consent', label: 'When the consent was signed', madpField: 'consentSignedAt', personal: false },
  'consent.optionalCount': { source: 'madp_consent', label: 'Optional consents given', madpField: 'consentOptionalCount', personal: false },
  'links.profiles': { source: 'madp_brand_links', label: 'Profiles page link', madpField: 'profileUrl', personal: false },
  'links.account': { source: 'madp_brand_links', label: 'Account page link', madpField: 'accountUrl', personal: false },
  'links.set_password': { source: 'madp_brand_links', label: 'Set-password page link', madpField: 'setPasswordUrl', personal: false },
  'links.accept_terms': { source: 'madp_brand_links', label: 'Terms page link', madpField: 'termsUrl', personal: false },
  unsubscribe_url: { source: 'madp_brand_links', label: 'Unsubscribe link', madpField: 'unsubscribeUrl', personal: false },
  preferences_url: { source: 'madp_brand_links', label: 'Email preferences link', madpField: 'preferencesUrl', personal: false },
};

export interface MailerTemplate {
  id: string;
  code: string | null;
  name: string;
  group: string;
  transactional: boolean;
  /** Sent to the team, not to members. */
  internal: boolean;
  trigger: string | null;
  subjects: string[];
  subjectsSample: string[];
  preheader: string | null;
  cta: string | null;
  reason: string | null;
  /** The MADP campaign kind it can be used for; null means the panel sends it at the event. */
  campaignKind: CampaignKind | null;
  fields: string[];
}
export interface MailerPack {
  id: string;
  title: string;
  panel: PanelCode;
  /** MHO packs are written for one audience; null means every member of the panel. */
  category: AudienceCategory | null;
  assetHost: string;
  templates: MailerTemplate[];
}

export const MailerQuery = z.object({
  panel: PanelCode.optional(),
  pack: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
});
export type MailerQuery = z.infer<typeof MailerQuery>;
export const MailerParams = z.object({
  pack: z.string().regex(/^[a-z0-9-]{1,40}$/),
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
});
export type MailerParams = z.infer<typeof MailerParams>;

/**
 * The library merge fields a studio template can carry, and the studio placeholder that fills each one. Anything
 * else (survey details, one-time codes, profile counts) is only known to the panel at send time, so a mailer that
 * uses it stays a panel email.
 */
export const MAILER_TO_STUDIO: Record<string, string> = {
  'user.name.first': 'firstName',
  'member.first_name': 'firstName',
  'user.mail': 'email',
  'member.email': 'email',
  'links.profiles': 'profileUrl',
  'links.account': 'accountUrl',
  unsubscribe_url: 'unsubscribeUrl',
  preferences_url: 'preferencesUrl',
};

/** Where a studio template came from, when it was made from a mailer pack. */
export interface StudioTemplateSource {
  pack: string;
  template: string;
  importedAt: string;
  /** The pack's image host, so previews can point at the copies the admin app serves. */
  assetHost: string;
}

export const MailerToStudio = z.object({
  /** Studio key; defaults to the pack and template ids. */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).optional(),
  /** Which of the pack's subject lines to use, from 0. */
  subject: z.number().int().min(0).max(9).default(0),
});
export type MailerToStudio = z.infer<typeof MailerToStudio>;
