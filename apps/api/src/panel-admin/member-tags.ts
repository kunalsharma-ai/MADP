import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { DataMode, PanelCode } from '@madp/contracts';
import { Database } from '../db/database.js';
import { memberTags } from '../db/schema.js';
import { AudienceService } from '../audience/audience.service.js';

/** Admin tags on panel members, per brand and data mode. */
@Injectable()
export class MemberTagStore {
  constructor(
    private readonly database: Database,
    private readonly audience: AudienceService,
  ) {}

  mode(): DataMode {
    return this.audience.defaultMode();
  }

  private where(panel: PanelCode) {
    return and(eq(memberTags.panel, panel), eq(memberTags.dataMode, this.mode()));
  }

  /** Tags of each member id given ({ id: [tag, ...] }). */
  async forMembers(panel: PanelCode, ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!ids.length) return out;
    const rows = await this.database.db
      .select({ id: memberTags.memberId, tag: memberTags.tag })
      .from(memberTags)
      .where(and(this.where(panel), inArray(memberTags.memberId, ids)))
      .orderBy(asc(memberTags.tag));
    for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.tag]);
    return out;
  }

  /** Every tag used on this brand, with how many members carry it. */
  async all(panel: PanelCode) {
    return this.database.db
      .select({ tag: memberTags.tag, members: count() })
      .from(memberTags)
      .where(this.where(panel))
      .groupBy(memberTags.tag)
      .orderBy(desc(count()), asc(memberTags.tag));
  }

  /** One page of member ids with a tag, newest tag first. */
  async page(panel: PanelCode, tag: string, page: number, size: number) {
    const w = and(this.where(panel), eq(memberTags.tag, tag));
    const [ids, [total]] = await Promise.all([
      this.database.db
        .select({ id: memberTags.memberId })
        .from(memberTags)
        .where(w)
        .orderBy(desc(memberTags.createdAt), asc(memberTags.memberId))
        .limit(size)
        .offset((page - 1) * size),
      this.database.db.select({ n: count() }).from(memberTags).where(w),
    ]);
    return { ids: ids.map((r) => r.id), total: total?.n ?? 0 };
  }

  /** Replaces a member's tags; returns what was added and removed. */
  async set(panel: PanelCode, memberId: string, tags: string[], actor: string) {
    const want = [...new Set(tags)];
    const have = (await this.forMembers(panel, [memberId])).get(memberId) ?? [];
    const added = want.filter((t) => !have.includes(t));
    const removed = have.filter((t) => !want.includes(t));
    await this.database.db.transaction(async (tx) => {
      if (removed.length)
        await tx.delete(memberTags).where(and(this.where(panel), eq(memberTags.memberId, memberId), inArray(memberTags.tag, removed)));
      if (added.length)
        await tx
          .insert(memberTags)
          .values(added.map((tag) => ({ panel, memberId, tag, dataMode: this.mode(), createdBy: actor })))
          .onConflictDoNothing();
    });
    return { tags: want.sort(), added, removed };
  }
}
