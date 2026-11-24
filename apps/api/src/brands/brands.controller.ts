import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PanelCode, type Permission } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { brandSettings } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { changed } from '../audit/mask.js';

const Host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, 'a hostname such as www.example.com');

export const BrandSettingsUpdate = z.object({
  displayName: z.string().min(2).max(80).optional(),
  origins: z.array(Host).min(1).max(10).optional(),
  languages: z
    .array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/))
    .min(1)
    .max(40)
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  pointsPerCurrencyUnit: z.number().int().min(1).max(1_000_000).optional(),
  minRedemptionPoints: z.number().int().min(0).max(100_000_000).optional(),
  fourEyesPoints: z.number().int().min(0).max(100_000_000).optional(),
  profileReviewMonths: z.number().int().min(1).max(36).optional(),
  archiveAfterMonths: z.number().int().min(1).max(60).optional(),
  /** Sender and reply-to for member e-mails. Sending stays behind the e-mail switches. */
  supportEmail: z.string().trim().toLowerCase().email().max(200).optional(),
  reason: z.string().trim().min(5).max(500),
});
export type BrandSettingsUpdate = z.infer<typeof BrandSettingsUpdate>;

const MONEY_FIELDS = ['pointsPerCurrencyUnit', 'minRedemptionPoints', 'fourEyesPoints', 'currency'] as const;

/**
 * Brands for the brand switcher and their settings. Points value, minimum redemption and the four-eyes amount are
 * money settings: Super Admin only (switches.flip), per the spec. Other settings need brands.manage on that brand.
 */
@Controller('brands')
export class BrandsController {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentPrincipal() p: Principal) {
    const rows = await this.database.db.select().from(brandSettings).orderBy(asc(brandSettings.panel));
    return {
      brands: rows
        .filter((r) => p.brands.includes(r.panel))
        .map((r) => ({ ...r, permissions: p.brandPermissions[r.panel] ?? [] })),
      /** Side-by-side view of every brand needs dashboard access on all of them. */
      allowAll: p.permissions.includes('dashboard.read'),
    };
  }

  @Put(':panel/settings')
  async update(
    @CurrentPrincipal() p: Principal,
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(BrandSettingsUpdate)) body: BrandSettingsUpdate,
    @Req() req: Request,
  ) {
    const row = await this.database.db.query.brandSettings.findFirst({
      where: eq(brandSettings.panel, panel),
    });
    if (!row) throw new NotFoundException();
    const { reason, ...patch } = body;
    const diff = changed(row as unknown as Record<string, unknown>, patch);
    const needed: Permission[] = ['brands.manage'];
    if (MONEY_FIELDS.some((f) => f in diff.after)) needed.push('switches.flip');
    if (!hasOn(p, panel, needed)) {
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'authz.denied',
        outcome: 'denied',
        panel,
        targetType: 'brand_setting',
        targetId: panel,
        metadata: { missing: needed },
      });
      throw new ForbiddenException('Not permitted on this brand');
    }
    if (!diff.any) return row;
    const [updated] = await this.database.db
      .update(brandSettings)
      .set({ ...patch, updatedBy: p.id, updatedAt: new Date() })
      .where(eq(brandSettings.panel, panel))
      .returning();
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'brands.settings.update',
      panel,
      targetType: 'brand_setting',
      targetId: panel,
      before: diff.before,
      after: diff.after,
      reason,
    });
    return updated;
  }
}
