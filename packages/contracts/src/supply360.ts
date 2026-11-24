import { z } from 'zod';
import { AttributeFilter, HealthAccessPurpose } from './audience.js';
import { AudienceCategory, PanelCode } from './panels.js';

/**
 * MADP ↔ Supply360 (spec §12, Milestone 6). Supply360 is a separate product: it calls MADP as a service client
 * with signed requests and scoped permissions, and gets aggregate counts, eligibility results and pseudonymous
 * references only. It never receives names, e-mail addresses, phone numbers, answers or health data.
 *
 * Signing: `x-madp-client: <clientId>`, `x-madp-timestamp: <unix seconds>`, `x-madp-nonce: <8-64 chars>`,
 * `x-madp-signature: v1=<hex HMAC-SHA256(secret, "<ts>.<nonce>.<METHOD>.<path>.<sha256 hex of body>")>`.
 * A nonce is accepted once; timestamps more than 300 s away are refused. POST requests that write take an
 * `idempotency-key` header: the same key with the same body returns the first answer again.
 */
export const ServiceScope = z.enum([
  'attributes.read',
  'audience.counts',
  'audience.match',
  'reservations.write',
  'invitations.authorize',
  'participation.write',
  'consent.check',
  'integrations.health',
  /** Counts that filter on special-category (health) attributes, for study feasibility only. */
  'health.aggregate',
]);
export type ServiceScope = z.infer<typeof ServiceScope>;

export const ServiceClientCreate = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(ServiceScope).min(1),
  panels: z.array(PanelCode).min(1),
  rateLimitPerMinute: z.number().int().min(1).max(6000).default(120),
});
export type ServiceClientCreate = z.infer<typeof ServiceClientCreate>;

const criteria = {
  panels: z.array(PanelCode).optional(),
  categories: z.array(AudienceCategory).optional(),
  countries: z.array(z.string().length(2)).optional(),
  verifiedEmailOnly: z.boolean().optional(),
  attributes: z.array(AttributeFilter).max(10).optional(),
};

export const ServiceCountsRequest = z.object({ ...criteria, purpose: HealthAccessPurpose.optional() });
export type ServiceCountsRequest = z.infer<typeof ServiceCountsRequest>;

/** Supply360's own project reference, kept with reservations, invitations and events. */
const projectRef = z.string().trim().regex(/^[A-Za-z0-9._:-]{2,80}$/);
const ref = z.string().regex(/^ref_[A-Za-z0-9_-]{16,40}$/);

export const MatchRequest = z.object({
  ...criteria,
  projectRef,
  limit: z.number().int().min(1).max(5000).default(500),
});
export type MatchRequest = z.infer<typeof MatchRequest>;

export const ReservationCreate = z.object({
  projectRef,
  refs: z.array(ref).min(1).max(5000),
  /** At most 14 days ahead. */
  expiresAt: z.string().datetime(),
});
export type ReservationCreate = z.infer<typeof ReservationCreate>;

export const InvitationAuthorize = z.object({
  reservationId: z.string().uuid(),
  refs: z.array(ref).min(1).max(5000),
});
export type InvitationAuthorize = z.infer<typeof InvitationAuthorize>;

export const PARTICIPATION_EVENTS = [
  'click',
  'start',
  'partial',
  'complete',
  'terminate',
  'quota_full',
  'quality_fail',
  'duplicate',
  'security_reject',
  'technical_error',
] as const;

export const ParticipationEvents = z.object({
  events: z
    .array(
      z.object({
        eventId: z.string().regex(/^[A-Za-z0-9._:-]{6,100}$/),
        invitationId: z.string().uuid(),
        event: z.enum(PARTICIPATION_EVENTS),
        occurredAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(1000),
});
export type ParticipationEvents = z.infer<typeof ParticipationEvents>;

export const ConsentCheck = z.object({
  refs: z.array(ref).min(1).max(5000),
  purpose: z.enum(['survey_invitation', 'email_marketing']),
});
export type ConsentCheck = z.infer<typeof ConsentCheck>;
