import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConsentCheck,
  InvitationAuthorize,
  MatchRequest,
  ParticipationEvents,
  ReservationCreate,
  ServiceClientCreate,
  ServiceCountsRequest,
} from '@madp/contracts';
import { CurrentPrincipal, Public, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { CurrentService, RequireScope, ServiceAuthGuard, type ServicePrincipal } from './service-auth.guard.js';
import { Supply360Service } from './supply360.service.js';

/**
 * The service API Supply360 calls (spec §12). Not an admin route: the admin session guard is skipped and every
 * request is checked by ServiceAuthGuard (signature, nonce, scope, rate limit) instead.
 */
@Public()
@SkipThrottle()
@UseGuards(ServiceAuthGuard)
@Controller('supply360')
export class Supply360Controller {
  constructor(
    private readonly s360: Supply360Service,
    private readonly registry: ConnectorRegistry,
  ) {}

  @RequireScope('attributes.read')
  @Get('attributes')
  attributes(@CurrentService() svc: ServicePrincipal) {
    return this.s360.attributes(svc);
  }

  @RequireScope('audience.counts')
  @Post('counts')
  @HttpCode(200)
  counts(@CurrentService() svc: ServicePrincipal, @Body(new ZodPipe(ServiceCountsRequest)) b: ServiceCountsRequest) {
    return this.s360.counts(svc, b);
  }

  @RequireScope('audience.match')
  @Post('match')
  @HttpCode(200)
  match(@CurrentService() svc: ServicePrincipal, @Body(new ZodPipe(MatchRequest)) b: MatchRequest) {
    return this.s360.match(svc, b);
  }

  @RequireScope('reservations.write')
  @Post('reservations')
  reserve(
    @CurrentService() svc: ServicePrincipal,
    @Body(new ZodPipe(ReservationCreate)) b: ReservationCreate,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.s360.idempotent(svc, key, 'reservations', b, () => this.s360.reserve(svc, b));
  }

  @RequireScope('reservations.write')
  @Get('reservations/:id')
  reservation(@CurrentService() svc: ServicePrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.s360.getReservation(svc, id);
  }

  @RequireScope('reservations.write')
  @Delete('reservations/:id')
  release(@CurrentService() svc: ServicePrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.s360.release(svc, id);
  }

  @RequireScope('invitations.authorize')
  @Post('invitations/authorize')
  @HttpCode(200)
  authorize(
    @CurrentService() svc: ServicePrincipal,
    @Body(new ZodPipe(InvitationAuthorize)) b: InvitationAuthorize,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.s360.idempotent(svc, key, 'invitations.authorize', b, () => this.s360.authorize(svc, b));
  }

  @RequireScope('participation.write')
  @Post('participation/events')
  @HttpCode(200)
  participation(
    @CurrentService() svc: ServicePrincipal,
    @Body(new ZodPipe(ParticipationEvents)) b: ParticipationEvents,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.s360.idempotent(svc, key, 'participation.events', b, () => this.s360.participation(svc, b));
  }

  @RequireScope('consent.check')
  @Post('consent/check')
  @HttpCode(200)
  consent(@CurrentService() svc: ServicePrincipal, @Body(new ZodPipe(ConsentCheck)) b: ConsentCheck) {
    return this.s360.consentCheck(svc, b);
  }

  /** Status of the panels this client may read: no panel data, no counts. */
  @RequireScope('integrations.health')
  @Get('integrations/health')
  async health(@CurrentService() svc: ServicePrincipal) {
    const slots = this.registry.all().filter((s) => svc.panels.includes(s.panel));
    const panels = await Promise.all(slots.map((s) => s.connector.health()));
    return { checkedAt: new Date().toISOString(), panels };
  }
}

/** MADP admins manage the Supply360 service clients. The secret is shown once, at creation. */
@Controller('service-clients')
export class ServiceClientsController {
  constructor(
    private readonly s360: Supply360Service,
    private readonly audience: AudienceService,
  ) {}

  @RequirePermissions('service_clients.manage')
  @Post()
  create(@Body(new ZodPipe(ServiceClientCreate)) b: ServiceClientCreate, @CurrentPrincipal() p: Principal) {
    return this.s360.createClient(this.audience.defaultMode(), b, p.id);
  }

  @RequirePermissions('service_clients.manage')
  @Get()
  list() {
    return this.s360.listClients();
  }

  @RequirePermissions('service_clients.manage')
  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id', new ParseUUIDPipe()) id: string, @CurrentPrincipal() p: Principal) {
    return this.s360.revokeClient(id, p.id);
  }
}
