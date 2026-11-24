import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  HelpCreate,
  HelpStatus,
  HelpUpdate,
  MessageCreate,
  MessagePreview,
  MessageSend,
  MessageUpdate,
  MessageWithdraw,
  TicketList,
  TicketReply,
  TicketStatusChange,
  TicketUpdate,
  type BrandSelection,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { Database } from '../db/database.js';
import { adminUsers } from '../db/schema.js';
import { PanelAdminService } from './panel-admin.service.js';

const Id = z.string().regex(/^[a-f0-9]{24}$/i, 'an id');
type Change = { before: Record<string, unknown> | null; after: Record<string, unknown> };
type Extra = Partial<Parameters<AuditService['record']>[0]>;
type Ticket = { id: string; no: string; member: { id: string; segment: string } | null };

/**
 * Ticket desk, portal messages and help centre (super admin spec, step 3b) for the brand picked in the switcher.
 * Nothing here sends e-mail: replies and messages show in the member's portal only.
 */
@Controller('panel')
@BrandScoped()
export class SupportAdminController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private log(
    req: Request,
    brand: PanelCode,
    action: string,
    targetType: string,
    targetId?: string,
    extra: Extra = {},
  ) {
    return this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      panel: brand,
      targetType,
      targetId,
      ...extra,
    });
  }

  /** A ticket from a teen needs teen.read, like the teen's member page. */
  private async ticket(p: Principal, brand: PanelCode, id: string, req: Request) {
    const t = await this.panel.call<Ticket & Record<string, unknown>>(brand, p.id, 'GET', R.ticket(id));
    if (t.member?.segment === 'teen' && !hasOn(p, brand, ['teen.read'])) {
      await this.log(req, brand, 'authz.denied', 'ticket', id, {
        outcome: 'denied',
        metadata: { missing: ['teen.read'] },
      });
      throw new ForbiddenException('Tickets from teens need the teen.read permission');
    }
    return t;
  }

  // ---- tickets ---------------------------------------------------------------------------------------------------
  @RequirePermissions('support.read')
  @Get('tickets')
  async tickets(
    @Query(new ZodPipe(TicketList)) q: TicketList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const teens = hasOn(p, brand, ['teen.read']);
    const r = await this.panel.call<{ total: number; page: number }>(brand, p.id, 'GET', R.tickets, {
      ...q,
      ...(teens ? {} : { noTeens: 1 }),
    });
    await this.log(req, brand, 'support.tickets.search', 'ticket', undefined, {
      metadata: { status: q.status ?? null, total: r.total, page: r.page },
    });
    return { ...r, teensHidden: !teens };
  }

  @RequirePermissions('support.read')
  @Get('tickets/:id')
  async getTicket(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const t = await this.ticket(p, brand, id, req);
    await this.log(req, brand, 'support.ticket.view', 'ticket', id, { metadata: { no: t.no } });
    return t;
  }

  @RequirePermissions('support.reply')
  @Post('tickets/:id/reply')
  async reply(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(TicketReply)) body: TicketReply,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const t = await this.ticket(p, brand, id, req);
    const me = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, p.id) });
    // members see the agent's first name only
    const agentName = `${(me?.displayName ?? 'Support').split(' ')[0]} (support team)`;
    const r = await this.panel.call<{ id: string; internal: boolean; status: string; emailSent: boolean }>(
      brand,
      p.id,
      'POST',
      R.ticketReply(id),
      undefined,
      { ...body, agentName },
    );
    await this.log(req, brand, body.internal ? 'support.ticket.note' : 'support.ticket.reply', 'ticket', id, {
      metadata: {
        no: t.no,
        comment: r.id,
        status: r.status,
        length: body.message.length,
        emailSent: r.emailSent,
      },
    });
    return r;
  }

  @RequirePermissions('support.reply')
  @Post('tickets/:id/status')
  async ticketStatus(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(TicketStatusChange)) body: TicketStatusChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.ticket(p, brand, id, req);
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.ticketStatus(id), undefined, {
      status: body.status,
    });
    await this.log(req, brand, 'support.ticket.status', 'ticket', id, {
      before: r.before,
      after: r.after,
      reason: body.reason ?? null,
    });
    return r;
  }

  @RequirePermissions('support.reply')
  @Put('tickets/:id')
  async updateTicket(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(TicketUpdate)) body: TicketUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.ticket(p, brand, id, req);
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.ticket(id), undefined, body);
    await this.log(req, brand, 'support.ticket.update', 'ticket', id, { before: r.before, after: r.after });
    return r;
  }

  // ---- portal messages ------------------------------------------------------------------------------------------
  @RequirePermissions('support.read')
  @Get('messages')
  messages(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.messages);
  }

  @RequirePermissions('support.read')
  @Get('messages/:id')
  message(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.message(id));
  }

  @RequirePermissions('messages.send')
  @Post('messages')
  async createMessage(
    @Body(new ZodPipe(MessageCreate)) body: MessageCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { id: string }>(
      brand,
      p.id,
      'POST',
      R.messages,
      undefined,
      body,
    );
    await this.log(req, brand, 'messages.create', 'portal_message', r.id, { after: { title: body.title } });
    return r;
  }

  @RequirePermissions('messages.send')
  @Put('messages/:id')
  async updateMessage(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(MessageUpdate)) body: MessageUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.message(id), undefined, body);
    await this.log(req, brand, 'messages.update', 'portal_message', id, { before: r.before, after: r.after });
    return r;
  }

  @RequirePermissions('messages.send')
  @Post('messages/:id/preview')
  preview(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(MessagePreview)) body: MessagePreview,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'POST', R.messagePreview(id), undefined, body);
  }

  /** A message to teens also needs teen.read on the brand. */
  @RequirePermissions('messages.send')
  @Post('messages/:id/send')
  async send(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(MessageSend)) body: MessageSend,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const pv = await this.panel.call<{ recipients: number; teens: number }>(
      brand,
      p.id,
      'POST',
      R.messagePreview(id),
      undefined,
      body.audienceId ? { audienceId: body.audienceId } : {},
    );
    if (pv.teens > 0 && !hasOn(p, brand, ['teen.read'])) {
      await this.log(req, brand, 'authz.denied', 'portal_message', id, {
        outcome: 'denied',
        metadata: { missing: ['teen.read'], teens: pv.teens },
      });
      throw new ForbiddenException('This message reaches teens, which needs the teen.read permission');
    }
    const r = await this.panel.call<Change & { recipients: number; emailSent: boolean }>(
      brand,
      p.id,
      'POST',
      R.messageSend(id),
      undefined,
      body.audienceId ? { audienceId: body.audienceId } : {},
    );
    await this.log(req, brand, 'messages.send', 'portal_message', id, {
      before: r.before,
      after: r.after,
      reason: body.reason,
      metadata: {
        recipients: r.recipients,
        teens: pv.teens,
        audienceId: body.audienceId ?? null,
        emailSent: r.emailSent,
      },
    });
    return r;
  }

  @RequirePermissions('messages.send')
  @Post('messages/:id/withdraw')
  async withdraw(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(MessageWithdraw)) body: MessageWithdraw,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.messageWithdraw(id));
    await this.log(req, brand, 'messages.withdraw', 'portal_message', id, {
      before: r.before,
      after: r.after,
      reason: body.reason,
    });
    return r;
  }

  // ---- help centre ----------------------------------------------------------------------------------------------
  @RequirePermissions('content.manage')
  @Get('help')
  help(
    @Query(new ZodPipe(z.object({ status: z.enum(['draft', 'published', 'archived']).optional() })))
    q: { status?: string },
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.help, q);
  }

  @RequirePermissions('content.manage')
  @Post('help')
  async createHelp(
    @Body(new ZodPipe(HelpCreate)) body: HelpCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { id: string }>(brand, p.id, 'POST', R.help, undefined, body);
    await this.log(req, brand, 'content.help.create', 'help_entry', r.id, {
      after: { slug: body.slug, title: body.title },
    });
    return r;
  }

  @RequirePermissions('content.manage')
  @Put('help/:id')
  async updateHelp(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(HelpUpdate)) body: HelpUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.helpEntry(id), undefined, body);
    await this.log(req, brand, 'content.help.update', 'help_entry', id, { before: r.before, after: r.after });
    return r;
  }

  @RequirePermissions('content.manage')
  @Post('help/:id/status')
  async helpStatus(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(HelpStatus)) body: HelpStatus,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.helpStatus(id), undefined, body);
    await this.log(req, brand, `content.help.${body.status}`, 'help_entry', id, {
      before: r.before,
      after: r.after,
    });
    return r;
  }
}
