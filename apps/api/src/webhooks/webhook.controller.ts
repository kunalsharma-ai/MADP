import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import { PanelCode, WEBHOOK_EVENT_ID, WebhookEvent } from '@madp/contracts';
import { z } from 'zod';
import { Public, RequirePermissions } from '../auth/decorators.js';
import { API_ENV } from '../common/tokens.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { verifyWebhook } from './signature.js';
import { WebhookService } from './webhook.service.js';

/** Signed webhook intake. Contract: packages/contracts/src/webhooks.ts. */
@Controller()
export class WebhookController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly webhooks: WebhookService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('webhooks/:panel')
  @HttpCode(202)
  async receive(@Param('panel', new ZodPipe(PanelCode)) panel: PanelCode, @Req() req: RawBodyRequest<Request>) {
    const secrets = this.webhooks.secretsFor(panel);
    // No secret means webhooks are off for this panel: answer as if the route did not exist.
    if (!secrets.length) throw new NotFoundException();
    const eventId = String(req.header('x-madp-event-id') ?? '');
    const raw = req.rawBody ?? Buffer.alloc(0);
    const reject = async (reason: string) => {
      await this.audit.record({
        actorId: null,
        actorType: 'system',
        action: 'webhook.rejected',
        targetType: 'panel',
        targetId: panel,
        metadata: { reason, bytes: raw.length },
        ip: req.ip ?? null,
      });
      return new UnauthorizedException('Webhook rejected');
    };
    if (!WEBHOOK_EVENT_ID.test(eventId)) throw await reject('bad_event_id');
    const v = verifyWebhook({
      secrets,
      header: req.header('x-madp-signature'),
      timestamp: req.header('x-madp-timestamp'),
      eventId,
      rawBody: raw,
      nowSeconds: Math.floor(Date.now() / 1000),
      toleranceSeconds: this.env.WEBHOOK_TOLERANCE_SECONDS,
    });
    if (!v.ok) throw await reject(v.reason);
    let event: WebhookEvent;
    try {
      event = WebhookEvent.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      // Signed but not a valid event: the panel sent something MADP does not accept (possibly personal data).
      throw new BadRequestException('Not a valid webhook event; only type and occurredAt are accepted');
    }
    const fresh = await this.webhooks.record(panel, eventId, event.type, createHash('sha256').update(raw).digest('hex'));
    if (!fresh) return { status: 'duplicate' };
    void this.webhooks.kick(panel);
    return { status: 'accepted' };
  }

  @RequirePermissions('connectors.read')
  @Get('webhooks/inbox')
  inbox(@Query(new ZodPipe(z.object({ panel: PanelCode.optional() }))) q: { panel?: PanelCode }) {
    return this.webhooks.inbox(q.panel);
  }
}
