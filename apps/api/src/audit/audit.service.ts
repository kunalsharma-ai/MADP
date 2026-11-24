import { Injectable } from '@nestjs/common';
import { asc, gt, sql } from 'drizzle-orm';
import type { PanelCode } from '@madp/contracts';
import type { Request } from 'express';
import { Database } from '../db/database.js';
import { auditEvents } from '../db/schema.js';
import { maskPersonal } from './mask.js';

export interface AuditEntry {
  actorId: string | null;
  actorType: 'admin' | 'system' | 'service';
  /** Roles the actor held, e.g. "brand_admin". Filled from the request by `fromRequest`. */
  actorRole?: string | null;
  /** The brand the action was taken in. */
  panel?: PanelCode | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'denied' | 'failure';
  /** Must not contain raw personal data; pass ids and counts only. */
  metadata?: Record<string, unknown>;
  /** Old and new values. Personal fields are masked before they are stored. */
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  /** First entry whose stored hash or link does not match. */
  firstBrokenId: number | null;
  problem: 'changed' | 'missing_or_reordered' | null;
  headId: number | null;
  headHash: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: Database) {}

  /** Actor, IP, device and request id from an admin request. */
  static fromRequest(
    req: Request,
  ): Pick<AuditEntry, 'actorId' | 'actorType' | 'actorRole' | 'ip' | 'userAgent' | 'requestId'> {
    return {
      actorId: req.principal?.id ?? null,
      actorType: 'admin',
      actorRole: req.principal?.roles.join(',') ?? null,
      ip: req.ip ?? null,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
      requestId: req.requestId ?? null,
    };
  }

  async record(e: AuditEntry): Promise<void> {
    await this.database.db.insert(auditEvents).values({
      actorId: e.actorId,
      actorType: e.actorType,
      actorRole: e.actorRole ?? null,
      panel: e.panel ?? null,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      outcome: e.outcome ?? 'success',
      metadata: e.metadata ?? {},
      before: e.before === undefined ? null : maskPersonal(e.before),
      after: e.after === undefined ? null : maskPersonal(e.after),
      reason: e.reason ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
      requestId: e.requestId ?? null,
    });
  }

  /**
   * Walks the whole chain in id order, recomputing each hash in the database with the same function the insert
   * trigger used. A changed entry fails its own hash; a deleted or re-ordered one breaks the next entry's link.
   */
  async verifyChain(batch = 5000): Promise<ChainCheck> {
    let prev: string | null = null;
    let cursor = 0;
    let checked = 0;
    let headId: number | null = null;
    for (;;) {
      const rows = await this.database.db
        .select({
          id: auditEvents.id,
          hash: auditEvents.hash,
          prevHash: auditEvents.prevHash,
          recomputed: sql<string>`madp_audit_hash(${auditEvents.prevHash}, ${sql.raw('audit_event')})`,
        })
        .from(auditEvents)
        .where(gt(auditEvents.id, cursor))
        .orderBy(asc(auditEvents.id))
        .limit(batch);
      for (const r of rows) {
        if ((r.prevHash ?? null) !== prev)
          return {
            ok: false,
            checked,
            firstBrokenId: r.id,
            problem: 'missing_or_reordered',
            headId,
            headHash: prev,
          };
        if (r.recomputed !== r.hash)
          return { ok: false, checked, firstBrokenId: r.id, problem: 'changed', headId, headHash: prev };
        prev = r.hash;
        headId = r.id;
        checked++;
      }
      if (rows.length < batch) break;
      cursor = rows.at(-1)!.id;
    }
    return { ok: true, checked, firstBrokenId: null, problem: null, headId, headHash: prev };
  }
}
