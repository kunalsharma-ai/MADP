import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import {
  AUDIENCE_CATEGORY_LABELS,
  BUILT_IN_SEGMENTS,
  BUILT_IN_SEGMENT_INFO,
  setKnownSegments,
  type AudienceSegmentInfo,
  type SegmentRuleInfo,
} from '@madp/contracts';
import { Database } from '../db/database.js';
import { audienceSegments, segmentRules } from '../db/schema.js';
import { setSegmentRules } from '../ingestion/canonical.js';

const BUILT_IN: AudienceSegmentInfo[] = BUILT_IN_SEGMENTS.map((key, i) => ({
  key,
  label: AUDIENCE_CATEGORY_LABELS[key]!,
  description: BUILT_IN_SEGMENT_INFO[key].description,
  minors: BUILT_IN_SEGMENT_INFO[key].minors,
  builtIn: true,
  status: 'active',
  sort: i + 1,
}));

/**
 * MADP's audience segments and the rules that turn a panel's own category value into segments, read from the
 * `audience_segment` and `segment_rule` tables. Re-read on start and after every change on the Audience segments
 * screen. Sync uses only active rules of active segments.
 */
@Injectable()
export class SegmentDirectory implements OnModuleInit {
  private readonly log = new Logger(SegmentDirectory.name);
  private list: AudienceSegmentInfo[] = BUILT_IN;
  private ruleList: SegmentRuleInfo[] = [];

  constructor(private readonly database: Database) {
    setKnownSegments(this.list.map((s) => s.key));
  }

  async onModuleInit() {
    await this.reload();
  }

  async reload() {
    try {
      const [rows, rules] = await Promise.all([
        this.database.db.select().from(audienceSegments).orderBy(asc(audienceSegments.sort), asc(audienceSegments.key)),
        this.database.db
          .select()
          .from(segmentRules)
          .orderBy(asc(segmentRules.panel), asc(segmentRules.sourceValue), asc(segmentRules.segment)),
      ]);
      if (rows.length) {
        this.list = rows.map((r) => ({
          key: r.key,
          label: r.label,
          description: r.description,
          minors: r.minors,
          builtIn: r.builtIn,
          status: r.status === 'archived' ? 'archived' : 'active',
          sort: r.sort,
        }));
        this.ruleList = rules.map((r) => ({
          id: r.id,
          panel: r.panel,
          sourceValue: r.sourceValue,
          segment: r.segment,
          minor: r.minor,
          evidence: r.evidence,
          status: r.status === 'archived' ? 'archived' : 'active',
        }));
        const active = new Set(this.keys());
        setSegmentRules(
          this.ruleList
            .filter((r) => r.status === 'active' && active.has(r.segment))
            .map((r) => ({ panel: r.panel, sourceValue: r.sourceValue, segment: r.segment, minor: r.minor })),
        );
      }
      // Archived segments stay known, so their old rows can still be read and filtered on.
      setKnownSegments(this.list.map((s) => s.key));
    } catch (e) {
      this.log.warn(`Segments not read (${(e as Error).message}); using the built-in ones`);
    }
  }

  all(): AudienceSegmentInfo[] {
    return this.list;
  }

  /** Keys of the active segments, in screen order. */
  keys(): string[] {
    return this.list.filter((s) => s.status === 'active').map((s) => s.key);
  }

  get(key: string): AudienceSegmentInfo | undefined {
    return this.list.find((s) => s.key === key);
  }

  label(key: string): string {
    return this.get(key)?.label ?? key;
  }

  rules(): SegmentRuleInfo[] {
    return this.ruleList;
  }
}
