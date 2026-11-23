import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { ApiEnv } from '@madp/config';
import {
  PANEL_CODES,
  type AttributeFilter,
  type CountCell,
  type CountsRequest,
  type CountsResponse,
  type DataMode,
} from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { attributeDefinitions, sourceQuestionMappings } from '../db/schema.js';
import { Mongo } from '../mongo/mongo.js';

type ResolvedFilter = NonNullable<CountsResponse['attributeFilters']>[number];

export interface CountsCaller {
  permissions: readonly string[];
}

@Injectable()
export class AudienceService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly registry: ConnectorRegistry,
    private readonly mongo: Mongo,
  ) {}

  /**
   * Resolves canonical attribute filters to the set of master person ids that match all of them, using only
   * APPROVED source question mappings (pending suggestions never affect counts). Returns null when no
   * attribute filter was given.
   *
   * Scale note: the person set is passed to SQL as an array. That is fine for DEMO and early live volumes;
   * a materialised attribute read model replaces it in M3 (docs/IMPLEMENTATION_PLAN.md).
   */
  private async resolveAttributes(
    mode: DataMode,
    filters: AttributeFilter[],
    caller: CountsCaller | undefined,
  ): Promise<{ personIds: string[]; resolved: ResolvedFilter[] } | null> {
    if (!filters.length) return null;
    const db = this.database.db;
    const defs = await db.query.attributeDefinitions.findMany({
      where: inArray(
        attributeDefinitions.key,
        filters.map((f) => f.key),
      ),
    });
    const defByKey = new Map(defs.map((d) => [d.key, d]));
    let people: Set<string> | null = null;
    const resolved: ResolvedFilter[] = [];
    for (const f of filters) {
      const def = defByKey.get(f.key);
      if (!def) throw new NotFoundException(`Unknown attribute ${f.key}`);
      if (def.sensitivity === 'special_category' && !caller?.permissions.includes('health.sensitive.read')) {
        throw new ForbiddenException(`Filtering on ${f.key} requires health.sensitive.read`);
      }
      const mappings = await db
        .select()
        .from(sourceQuestionMappings)
        .where(
          and(
            eq(sourceQuestionMappings.dataMode, mode),
            eq(sourceQuestionMappings.attributeKey, f.key),
            eq(sourceQuestionMappings.status, 'approved'),
          ),
        );
      resolved.push({
        key: f.key,
        sensitivity: def.sensitivity,
        approvedMappings: mappings.length,
        panels: [...new Set(mappings.map((m) => m.panel))].sort(),
      });
      const wanted = new Set(f.values);
      const matched = new Set<string>();
      for (const m of mappings) {
        // A value map translates source codes to canonical values; without one, values are taken as-is.
        const valueMap = (m.valueMap ?? null) as Record<string, string> | null;
        const answers = this.mongo.profileAnswers.find(
          {
            dataMode: mode,
            panel: m.panel,
            sourceQuestionId: m.sourceQuestionId,
            questionVersion: m.questionVersion,
          },
          { projection: { personId: 1, values: 1 } },
        );
        for await (const a of answers) {
          if (a.values.some((v) => wanted.has(valueMap?.[v] ?? v))) matched.add(a.personId);
        }
      }
      const current: Set<string> = people ?? matched;
      people = new Set([...current].filter((id) => matched.has(id)));
    }
    return { personIds: [...(people ?? [])], resolved };
  }

  /** LIVE as soon as any panel is live; DEMO otherwise. Counts are never computed across both modes. */
  defaultMode(): DataMode {
    return this.registry.all().some((s) => s.dataMode === 'live') ? 'live' : 'demo';
  }

  private where(mode: DataMode, f: CountsRequest, personIds: string[] | null = null): SQL {
    const parts: SQL[] = [sql`pm.data_mode = ${mode}`, sql`pm.status = 'active'`];
    // Passed as one array literal parameter (drizzle would expand a JS array into a value list).
    if (personIds) parts.push(sql`pm.master_person_id = any(${`{${personIds.join(',')}}`}::uuid[])`);
    if (f.panels?.length)
      parts.push(
        sql`pm.panel::text in (${sql.join(
          f.panels.map((p) => sql`${p}`),
          sql`, `,
        )})`,
      );
    if (f.countries?.length)
      parts.push(
        sql`mp.country in (${sql.join(
          f.countries.map((c) => sql`${c.toLowerCase()}`),
          sql`, `,
        )})`,
      );
    if (f.verifiedEmailOnly) parts.push(sql`si.email_verification = 'verified'`);
    if (f.categories?.length) {
      parts.push(sql`exists (select 1 from category_membership cm2 where cm2.master_person_id = pm.master_person_id and cm2.panel = pm.panel
        and cm2.category::text in (${sql.join(
          f.categories.map((c) => sql`${c}`),
          sql`, `,
        )}))`);
    }
    return sql.join(parts, sql` and `);
  }

  async counts(
    f: CountsRequest,
    mode: DataMode = this.defaultMode(),
    minimumCellSize = this.env.MIN_CELL_SIZE,
    caller?: CountsCaller,
  ): Promise<CountsResponse> {
    const db = this.database.db;
    const attr = await this.resolveAttributes(mode, f.attributes ?? [], caller);
    const ids = attr?.personIds ?? null;
    const base = sql`from panel_membership pm join master_person mp on mp.id = pm.master_person_id join source_identity si on si.id = pm.source_identity_id where ${this.where(mode, f, ids)}`;
    const totals = await db.execute<{ people: string; memberships: string }>(
      sql`select count(distinct pm.master_person_id) as people, count(*) as memberships ${base}`,
    );
    const byPanel = await db.execute<{ key: string; n: string }>(
      sql`select pm.panel::text as key, count(distinct pm.master_person_id) as n ${base} group by 1 order by 1`,
    );
    const byCountry = await db.execute<{ key: string; n: string }>(
      sql`select coalesce(mp.country, 'unknown') as key, count(distinct pm.master_person_id) as n ${base} group by 1 order by 2 desc`,
    );
    const catFilter = f.categories?.length
      ? sql`and cm.category::text in (${sql.join(
          f.categories.map((c) => sql`${c}`),
          sql`, `,
        )})`
      : sql``;
    const byCategory = await db.execute<{ key: string; n: string }>(sql`
      select cm.category::text as key, count(distinct cm.master_person_id) as n
      from category_membership cm
      where cm.data_mode = ${mode} ${catFilter} and exists (
        select 1 from panel_membership pm join master_person mp on mp.id = pm.master_person_id join source_identity si on si.id = pm.source_identity_id
        where pm.master_person_id = cm.master_person_id and pm.panel = cm.panel and ${this.where(mode, f, ids)})
      group by 1 order by 1`);
    const catTotal = await db.execute<{ n: string }>(sql`
      select count(*) as n from (select distinct cm.master_person_id, cm.category from category_membership cm
      where cm.data_mode = ${mode} ${catFilter} and exists (
        select 1 from panel_membership pm join master_person mp on mp.id = pm.master_person_id join source_identity si on si.id = pm.source_identity_id
        where pm.master_person_id = cm.master_person_id and pm.panel = cm.panel and ${this.where(mode, f, ids)})) x`);
    const panels = f.panels?.length ? f.panels : [...PANEL_CODES];
    const sync = await db.execute<{ min: Date | null; max: Date | null }>(sql`
      select min(last_success_at) as min, max(last_success_at) as max from sync_checkpoint
      where data_mode = ${mode} and stream = 'respondents' and panel::text in (${sql.join(
        panels.map((p) => sql`${p}`),
        sql`, `,
      )})`);

    const cell = (rows: { key: string; n: string }[]): CountCell[] =>
      rows.map(({ key, n }) => {
        const v = Number(n);
        const suppressed = v > 0 && v < minimumCellSize;
        return { key, value: suppressed ? null : v, suppressed };
      });
    const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
    return {
      dataMode: mode,
      uniquePeople: Number(totals.rows[0]?.people ?? 0),
      panelMemberships: Number(totals.rows[0]?.memberships ?? 0),
      categoryMemberships: Number(catTotal.rows[0]?.n ?? 0),
      byPanel: cell(byPanel.rows),
      byCategory: cell(byCategory.rows),
      byCountry: cell(byCountry.rows),
      minimumCellSize,
      computedAt: new Date().toISOString(),
      freshestSourceSyncAt: iso(sync.rows[0]?.max),
      oldestSourceSyncAt: iso(sync.rows[0]?.min),
      ...(attr ? { attributeFilters: attr.resolved } : {}),
    };
  }
}
