import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MailerParams, MailerQuery, MailerToStudio, type BrandSelection } from '@madp/contracts';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { EngagementService } from '../engagement/engagement.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MailersService } from './mailers.service.js';
import { PanelDirectory } from '../panels/panel-directory.js';

/** The panels' mailer packs, read-only, for the selected brand. Previews use the designers' sample data only. */
@Controller('communications/mailers')
export class MailersController {
  constructor(
    private readonly panelDirectory: PanelDirectory,
    private readonly mailers: MailersService,
    private readonly engagement: EngagementService,
  ) {}

  @RequirePermissions('communications.read')
  @BrandScoped({ allowAll: true })
  @Get()
  list(@Query(new ZodPipe(MailerQuery)) q: MailerQuery, @CurrentBrand() brand: BrandSelection) {
    return this.mailers.list(this.panelDirectory.forBrand(brand, q.panel), q.pack);
  }

  @RequirePermissions('communications.read')
  @BrandScoped({ allowAll: true })
  @Get(':pack/:id')
  detail(@Param(new ZodPipe(MailerParams)) p: MailerParams, @CurrentBrand() brand: BrandSelection) {
    return this.mailers.detail(this.panelDirectory.forBrand(brand), p.pack, p.id);
  }

  @RequirePermissions('communications.read')
  @BrandScoped({ allowAll: true })
  @Get(':pack/:id/preview')
  preview(@Param(new ZodPipe(MailerParams)) p: MailerParams, @CurrentBrand() brand: BrandSelection) {
    return this.mailers.preview(this.panelDirectory.forBrand(brand), p.pack, p.id);
  }

  /**
   * Makes a studio template (a new draft version) from a campaign mailer, for the brand's own panel. It goes through
   * the studio's review like any other version, and nothing is sent.
   */
  @RequirePermissions('communications.manage')
  @BrandScoped()
  @Post(':pack/:id/studio')
  async toStudio(
    @Param(new ZodPipe(MailerParams)) p: MailerParams,
    @Body(new ZodPipe(MailerToStudio)) b: MailerToStudio,
    @CurrentBrand() brand: BrandSelection,
    @CurrentPrincipal() principal: Principal,
    @Req() req: Request,
  ) {
    const m = this.mailers.toStudio(this.panelDirectory.forBrand(brand), p.pack, p.id, b.subject);
    const r = await this.engagement.createFromMailer({ ...m, key: b.key ?? m.key }, { id: principal.id, ip: req.ip ?? null });
    return { ...r, added: m.added };
  }
}
