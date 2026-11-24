import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { IdentityCandidateQuery, IdentityDecision, IdentityUnlink } from '@madp/contracts';
import type { Request } from 'express';
import { RequirePermissions, CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { AuditService } from '../audit/audit.service.js';
import { IdentityService } from './identity.service.js';

/** Cross-panel identity review: match candidates, merge, unmerge and link history. */
@Controller('identity')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('identity.review')
  @Get('candidates')
  async candidates(
    @Query(new ZodPipe(IdentityCandidateQuery)) q: IdentityCandidateQuery,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const res = await this.identity.candidates(this.audience.defaultMode(), q);
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'identity.candidates_viewed',
      targetType: 'identity_match_candidate',
      metadata: { status: q.status, panel: q.panel ?? null, rows: res.items.length },
      ip: req.ip ?? null,
    });
    return res;
  }

  @RequirePermissions('identity.review')
  @Post('candidates/:id/decision')
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(IdentityDecision)) body: IdentityDecision,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.identity.decide(id, body.decision, body.reason, { id: p.id, ip: req.ip ?? null });
  }

  @RequirePermissions('identity.review')
  @Post('source-identities/:id/unlink')
  unlink(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(IdentityUnlink)) body: IdentityUnlink,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.identity.unlink(id, body.reason, { id: p.id, ip: req.ip ?? null });
  }

  @RequirePermissions('identity.review')
  @Get('persons/:id/history')
  async history(@Param('id', new ParseUUIDPipe()) id: string) {
    return { items: await this.identity.history(id) };
  }
}
