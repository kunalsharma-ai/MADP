import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Req } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  MemberNoteCreate,
  MemberTagsSet,
  type BrandSelection,
  type MemberTagsNotes,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { adminUsers, memberNotes } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';
import { MemberTagStore } from './member-tags.js';

const MemberId = z.string().regex(/^[a-f0-9]{24}$/i, 'a member id');
const NoteId = z.string().uuid();

/**
 * Tags and notes on a panel member, kept in MADP for the brand picked in the switcher (T2O, MFR, MHO or any added
 * panel). Notes are free text, so reading them is audited. Teen members need teen.read.
 */
@Controller('panel/members')
@BrandScoped()
export class MemberNotesController {
  constructor(
    private readonly database: Database,
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
    private readonly tags: MemberTagStore,
  ) {}

  /** The member must exist on this brand; teens need teen.read. */
  private async check(p: Principal, brand: PanelCode, id: string, req: Request) {
    const m = await this.panel.call<{ id: string; segment?: string }>(brand, p.id, 'GET', R.member(id));
    if (m.segment === 'teen' && !hasOn(p, brand, ['teen.read'])) {
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'authz.denied',
        outcome: 'denied',
        panel: brand,
        targetType: 'member',
        targetId: id,
        metadata: { missing: ['teen.read'] },
      });
      throw new ForbiddenException('Teen records need the teen.read permission');
    }
  }

  @RequirePermissions('members.read')
  @Get(':id/notes')
  async list(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ): Promise<MemberTagsNotes> {
    const brand = b as PanelCode;
    await this.check(p, brand, id, req);
    const [tags, rows] = await Promise.all([
      this.tags.forMembers(brand, [id]),
      this.database.db
        .select({ n: memberNotes, author: adminUsers.displayName })
        .from(memberNotes)
        .leftJoin(adminUsers, eq(adminUsers.id, memberNotes.createdBy))
        .where(and(eq(memberNotes.panel, brand), eq(memberNotes.dataMode, this.tags.mode()), eq(memberNotes.memberId, id)))
        .orderBy(desc(memberNotes.pinned), desc(memberNotes.createdAt))
        .limit(200),
    ]);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.notes_read',
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { notes: rows.length },
    });
    return {
      tags: tags.get(id) ?? [],
      notes: rows.map(({ n, author }) => ({
        id: n.id,
        body: n.body,
        pinned: n.pinned,
        author,
        mine: n.createdBy === p.id,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  @RequirePermissions('members.edit')
  @Put(':id/tags')
  async setTags(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberTagsSet)) body: MemberTagsSet,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.check(p, brand, id, req);
    const r = await this.tags.set(brand, id, body.tags, p.id);
    if (r.added.length || r.removed.length)
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'members.tags_changed',
        panel: brand,
        targetType: 'member',
        targetId: id,
        metadata: { added: r.added, removed: r.removed },
      });
    return { tags: r.tags };
  }

  @RequirePermissions('members.edit')
  @Post(':id/notes')
  async addNote(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberNoteCreate)) body: MemberNoteCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.check(p, brand, id, req);
    const [row] = await this.database.db
      .insert(memberNotes)
      .values({ panel: brand, memberId: id, dataMode: this.tags.mode(), body: body.body, pinned: body.pinned, createdBy: p.id })
      .returning({ id: memberNotes.id });
    // The note text itself stays out of the audit trail (it may hold personal data).
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.note_added',
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { noteId: row!.id, length: body.body.length, pinned: body.pinned },
    });
    return { id: row!.id };
  }

  /** Only the author deletes a note. */
  @RequirePermissions('members.edit')
  @Delete(':id/notes/:noteId')
  @HttpCode(200)
  async removeNote(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Param('noteId', new ZodPipe(NoteId)) noteId: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const gone = await this.database.db
      .delete(memberNotes)
      .where(and(eq(memberNotes.id, noteId), eq(memberNotes.panel, brand), eq(memberNotes.memberId, id), eq(memberNotes.createdBy, p.id)))
      .returning({ id: memberNotes.id });
    if (!gone.length) throw new NotFoundException('Note not found, or it is not yours');
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.note_deleted',
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { noteId },
    });
    return { deleted: noteId };
  }
}

/** Every tag in use on the brand, for the Members filter and the tag picker. */
@Controller('member-tags')
@BrandScoped()
export class MemberTagsController {
  constructor(private readonly tags: MemberTagStore) {}

  @RequirePermissions('members.read')
  @Get()
  async list(@CurrentBrand() b: BrandSelection) {
    return { tags: await this.tags.all(b as PanelCode) };
  }
}
