import { Injectable } from '@nestjs/common';
import { Database } from '../db/database.js';
import { auditEvents } from '../db/schema.js';

export interface AuditEntry {
  actorId: string | null;
  actorType: 'admin' | 'system' | 'service';
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'denied' | 'failure';
  /** Must not contain raw personal data; pass ids and counts only. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: Database) {}

  async record(e: AuditEntry): Promise<void> {
    await this.database.db.insert(auditEvents).values({
      actorId: e.actorId,
      actorType: e.actorType,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      outcome: e.outcome ?? 'success',
      metadata: e.metadata ?? {},
      ip: e.ip ?? null,
    });
  }
}
