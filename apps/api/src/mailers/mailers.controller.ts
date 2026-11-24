import { Controller, Get, Param, Query } from '@nestjs/common';
import { MailerParams, MailerQuery, type BrandSelection } from '@madp/contracts';
import { BrandScoped, CurrentBrand, RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { VerificationService } from '../verification/verification.service.js';
import { MailersService } from './mailers.service.js';

/** The panels' mailer packs, read-only, for the selected brand. Previews use the designers' sample data only. */
@Controller('communications/mailers')
export class MailersController {
  constructor(private readonly mailers: MailersService) {}

  @RequirePermissions('communications.read')
  @BrandScoped({ allowAll: true })
  @Get()
  list(@Query(new ZodPipe(MailerQuery)) q: MailerQuery, @CurrentBrand() brand: BrandSelection) {
    return this.mailers.list(VerificationService.panelsFor(brand, q.panel), q.pack);
  }

  @RequirePermissions('communications.read')
  @BrandScoped({ allowAll: true })
  @Get(':pack/:id')
  detail(@Param(new ZodPipe(MailerParams)) p: MailerParams, @CurrentBrand() brand: BrandSelection) {
    return this.mailers.detail(VerificationService.panelsFor(brand), p.pack, p.id);
  }

  @RequirePermissions('communications.read')
  @BrandScoped({ allowAll: true })
  @Get(':pack/:id/preview')
  preview(@Param(new ZodPipe(MailerParams)) p: MailerParams, @CurrentBrand() brand: BrandSelection) {
    return this.mailers.preview(VerificationService.panelsFor(brand), p.pack, p.id);
  }
}
