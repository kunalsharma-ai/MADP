import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
  ChannelAction,
  ChannelName,
  ChannelSave,
  RemindersPreview,
  RemindersSave,
  type BrandSelection,
  type ChannelSetup,
  type ChannelsView,
  type PanelCode,
  type RemindersView,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';

/**
 * Auto reminders and WhatsApp / SMS providers for the brand picked in the switcher (panel side: MFR#105). Admins set,
 * per case, on/off, every how many days and at most how many; the panel does the rest with plain rules. Sending stays
 * behind the panel's switches (email_reminders, whatsapp, sms), flipped on the Switches screen by Super Admin.
 * Provider keys go straight to the panel, which stores them encrypted; MADP never stores or logs them.
 */
@Controller('panel')
@BrandScoped()
export class RemindersController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
  ) {}

  private log(
    req: Request,
    brand: PanelCode,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      panel: brand,
      targetType: 'reminders',
      targetId,
      metadata,
    });
  }

  @RequirePermissions('communications.read')
  @Get('reminders')
  async get(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    const brand = b as PanelCode;
    const r = await this.panel.call<RemindersView>(brand, p.id, 'GET', R.reminders);
    return {
      ...r,
      canEdit: hasOn(p, brand, ['communications.manage']),
      canSetUpChannels: hasOn(p, brand, ['brands.manage']),
      canFlip: hasOn(p, brand, ['switches.flip']),
    };
  }

  @RequirePermissions('communications.manage')
  @Put('reminders')
  async save(
    @Body(new ZodPipe(RemindersSave)) body: RemindersSave,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const before = await this.panel.call<RemindersView>(brand, p.id, 'GET', R.reminders);
    const after = await this.panel.call<RemindersView>(brand, p.id, 'PUT', R.reminders, undefined, body);
    const was = new Map(before.cases.map((c) => [c.key, c]));
    const changed = after.cases
      .filter((c) => JSON.stringify(was.get(c.key)) !== JSON.stringify(c))
      .map((c) => ({ key: c.key, before: was.get(c.key), after: c }));
    await this.log(req, brand, 'reminders.settings_changed', brand, {
      reason: body.reason,
      changed,
      minGapDays: { before: before.minGapDays, after: after.minGapDays },
    });
    return after;
  }

  /** Who would get which reminder right now: counts only. Nothing is sent or saved. */
  @RequirePermissions('communications.read')
  @Post('reminders/preview')
  @HttpCode(200)
  preview(
    @Body(new ZodPipe(RemindersPreview)) body: RemindersPreview,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'POST', R.remindersPreview, undefined, body);
  }

  @RequirePermissions('communications.read')
  @Get('channels')
  channels(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call<ChannelsView>(b as PanelCode, p.id, 'GET', R.channels);
  }

  /** Sets up a WhatsApp or SMS provider. Super Admin (brands.manage) only; the keys are never logged. */
  @RequirePermissions('brands.manage')
  @Put('channels/:channel')
  async saveChannel(
    @Param('channel', new ZodPipe(ChannelName)) channel: ChannelName,
    @Body(new ZodPipe(ChannelSave)) body: ChannelSave,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...rest } = body;
    const r = await this.panel.call<ChannelSetup>(brand, p.id, 'PUT', R.channel(channel), undefined, rest);
    await this.log(req, brand, 'channels.provider_saved', channel, {
      reason,
      provider: r.provider,
      sender: r.sender,
      keyHint: r.keyHint,
      keysChanged: Object.values(body.credentials ?? {}).some((v) => v !== ''),
      templates: Object.keys(r.templates ?? {}),
    });
    return r;
  }

  /** Asks the provider whether the saved keys work. Sends no message. */
  @RequirePermissions('brands.manage')
  @Post('channels/:channel/check')
  @HttpCode(200)
  async check(
    @Param('channel', new ZodPipe(ChannelName)) channel: ChannelName,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ ok: boolean; message: string }>(
      brand,
      p.id,
      'POST',
      R.channelCheck(channel),
      undefined,
      {},
    );
    await this.log(req, brand, 'channels.provider_checked', channel, { ok: r.ok });
    return r;
  }

  @RequirePermissions('brands.manage')
  @Post('channels/:channel/remove')
  @HttpCode(200)
  async remove(
    @Param('channel', new ZodPipe(ChannelName)) channel: ChannelName,
    @Body(new ZodPipe(ChannelAction)) body: ChannelAction,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ removed: boolean }>(
      brand,
      p.id,
      'POST',
      R.channelRemove(channel),
      undefined,
      {},
    );
    await this.log(req, brand, 'channels.provider_removed', channel, {
      reason: body.reason,
      removed: r.removed,
    });
    return r;
  }
}
