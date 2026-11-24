import { z } from 'zod';

/**
 * Signed webhook from a panel (POST /api/v1/webhooks/:panel). A webhook only says "something changed": MADP then
 * reads the change through the panel's changes feed, so the payload carries no personal data and is rejected if it
 * has any field beyond these.
 *
 * Headers:
 * - `x-madp-event-id`: unique per event, 1-200 of [A-Za-z0-9._:-]. A repeat is acknowledged and ignored.
 * - `x-madp-timestamp`: Unix seconds. Rejected when further than WEBHOOK_TOLERANCE_SECONDS from MADP's clock.
 * - `x-madp-signature`: `v1=<hex HMAC-SHA256>` of `<timestamp>.<event id>.<raw body>` with the panel's secret.
 *   Several comma-separated `v1=` values are allowed while a secret is being rotated.
 */
export const WebhookEventType = z.enum([
  'member.changed',
  'member.deleted',
  'answers.changed',
  'answers.reset',
  'consent.changed',
  'questions.changed',
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const WebhookEvent = z
  .object({
    type: WebhookEventType,
    occurredAt: z.string().datetime().optional(),
  })
  .strict();
export type WebhookEvent = z.infer<typeof WebhookEvent>;

export const WEBHOOK_EVENT_ID = /^[A-Za-z0-9._:-]{1,200}$/;
