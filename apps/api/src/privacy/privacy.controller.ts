import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { PrivacyQuery, PrivacyRequestCreate, PrivacyStep } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { PrivacyService } from './privacy.service.js';

const actor = (p: Principal, req: Request) => ({ id: p.id, ip: req.ip ?? null });

@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly audience: AudienceService,
  ) {}

  @RequirePermissions('privacy.read')
  @Get('requests')
  list(@Query(new ZodPipe(PrivacyQuery)) q: PrivacyQuery) {
    return this.privacy.list(this.audience.defaultMode(), q);
  }

  @RequirePermissions('privacy.request')
  @Post('requests')
  create(@Body(new ZodPipe(PrivacyRequestCreate)) b: PrivacyRequestCreate, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.create(this.audience.defaultMode(), b, actor(p, req));
  }

  @RequirePermissions('privacy.read')
  @Get('requests/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.privacy.get(id);
  }

  @RequirePermissions('privacy.execute')
  @Post('requests/:id/verify')
  @HttpCode(200)
  verify(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PrivacyStep)) b: PrivacyStep, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.verify(id, b.note, actor(p, req));
  }

  @RequirePermissions('privacy.execute')
  @Post('requests/:id/execute')
  @HttpCode(200)
  execute(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PrivacyStep)) b: PrivacyStep, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.execute(id, b.note, actor(p, req));
  }

  @RequirePermissions('privacy.execute')
  @Post('requests/:id/reject')
  @HttpCode(200)
  reject(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PrivacyStep)) b: PrivacyStep, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.reject(id, b.note, actor(p, req));
  }

  @RequirePermissions('privacy.execute')
  @Post('requests/:id/complete')
  @HttpCode(200)
  complete(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PrivacyStep)) b: PrivacyStep, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.complete(id, b.note, actor(p, req));
  }

  /** The member's own data, decrypted, for a verified access request. Needs PII and health permissions too. */
  @RequirePermissions('privacy.execute', 'panellists.pii.read', 'health.sensitive.read')
  @Get('requests/:id/export')
  export(@Param('id', new ParseUUIDPipe()) id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.exportFor(id, actor(p, req));
  }

  @RequirePermissions('privacy.read')
  @Get('retention')
  retention() {
    return this.privacy.retention(this.audience.defaultMode());
  }

  @RequirePermissions('privacy.execute')
  @Post('retention/:key/purge')
  @HttpCode(200)
  purge(@Param('key') key: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.privacy.purge(this.audience.defaultMode(), key, actor(p, req));
  }
}
