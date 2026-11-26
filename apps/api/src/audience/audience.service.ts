import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { ApiEnv } from '@madp/config';
import {
  type AttributeFilter,
  type CountCell,
  type CountsRequest,
  type CountsResponse,
  type DataMode,
  type GeoRequest,
  type GeoResponse,
  type OverlapResponse,
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
  async resolveAttributes(
    mode: DataMode,
    filters: AttributeFilter[],
    caller: CountsCaller | undefined,
    purpose?: string,
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
      if (def.sensitivity === 'special_category' && caller && !purpose) {
        throw new ForbiddenException(`Filtering on ${f.key} needs a stated purpose (purpose)`);
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

  where(mode: DataMode, f: CountsRequest, personIds: string[] | null = null): SQL {
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
    const attr = await this.resolveAttributes(mode, f.attributes ?? [], caller, f.purpose);
    const ids = attr?.personIds ?? null;
    // Counts narrowed by health or other special-category answers use a larger minimum cell.
    if (attr?.resolved.some((r) => r.sensitivity === 'special_category'))
      minimumCellSize = Math.max(minimumCellSize, this.env.SENSITIVE_MIN_CELL_SIZE);
    const base = sql`from panel_membership pm join master_person mp on mp.id = pm.master_person_id join source_identity si on si.id = pm.source_identity_id where ${this.where(mode, f, ids)}`;
    const catFilter = f.categories?.length
      ? sql`and cm.category::text in (${sql.join(
          f.categories.map((c) => sql`${c}`),
          sql`, `,
        )})`
      : sql``;
    // One pass over the matching memberships, kept for the totals and every breakdown.
    const rows = (
      await db.execute<{ kind: string; key: string; n: string }>(sql`
        with hit as materialized (
          select pm.master_person_id as person, pm.panel, coalesce(mp.country, 'unknown') as country ${base}),
        cat as (
          select distinct cm.master_person_id as person, cm.category::text as category
          from category_membership cm join hit on hit.person = cm.master_person_id and hit.panel = cm.panel
          where cm.data_mode = ${mode} ${catFilter})
        select 'total' as kind, 'people' as key, count(distinct person) as n from hit
        union all select 'total', 'memberships', count(*) from hit
        union all select 'total', 'categories', count(*) from cat
        union all (select 'panel', panel::text, count(distinct person) from hit group by 2)
        union all (select 'country', country, count(distinct person) from hit group by 2)
        union all (select 'category', category, count(distinct person) from cat group by 2)`)
    ).rows;
    const total = (key: string) => Number(rows.find((r) => r.kind === 'total' && r.key === key)?.n ?? 0);
    const part = (kind: string) => rows.filter((r) => r.kind === kind);
    const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const byPanel = part('panel').sort(byKey);
    const byCountry = part('country').sort((a, b) => Number(b.n) - Number(a.n) || byKey(a, b));
    const byCategory = part('category').sort(byKey);
    const panels = f.panels?.length ? f.panels : this.registry.all().map((x) => x.panel);
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
      uniquePeople: total('people'),
      panelMemberships: total('memberships'),
      categoryMemberships: total('categories'),
      byPanel: cell(byPanel),
      byCategory: cell(byCategory),
      byCountry: cell(byCountry),
      minimumCellSize,
      computedAt: new Date().toISOString(),
      freshestSourceSyncAt: iso(sync.rows[0]?.max),
      oldestSourceSyncAt: iso(sync.rows[0]?.min),
      ...(attr ? { attributeFilters: attr.resolved } : {}),
    };
  }

  /** Narrowing filters shared by geo and overlap: the counts filters plus attribute matches and their cell size. */
  private async scope(f: CountsRequest, mode: DataMode, minimumCellSize: number, caller?: CountsCaller) {
    const attr = await this.resolveAttributes(mode, f.attributes ?? [], caller, f.purpose);
    if (attr?.resolved.some((r) => r.sensitivity === 'special_category'))
      minimumCellSize = Math.max(minimumCellSize, this.env.SENSITIVE_MIN_CELL_SIZE);
    const hide = (v: number) => v > 0 && v < minimumCellSize;
    return { ids: attr?.personIds ?? null, resolved: attr?.resolved ?? [], minimumCellSize, hide };
  }

  /** Country, then state or province, then city. Unique people per place, split by panel, small cells hidden. */
  async geo(f: GeoRequest, mode: DataMode = this.defaultMode(), caller?: CountsCaller): Promise<GeoResponse & { attributeFilters: unknown[] }> {
    const db = this.database.db;
    const s = await this.scope(f, mode, this.env.MIN_CELL_SIZE, caller);
    const level = f.state ? 'city' : f.country ? 'state' : 'country';
    const place = (c: string) => sql.raw(`coalesce(nullif(mp.${c}, ''), 'unknown')`);
    const col = place(level);
    const narrow = [this.where(mode, { ...f, countries: f.country ? [f.country] : undefined }, s.ids)];
    if (f.state) narrow.push(sql`coalesce(nullif(mp.state, ''), 'unknown') = ${f.state}`);
    const base = sql`from panel_membership pm join master_person mp on mp.id = pm.master_person_id
      join source_identity si on si.id = pm.source_identity_id where ${sql.join(narrow, sql` and `)}`;
    const rows = (
      await db.execute<{ key: string; people: string; t2o: string; mfr: string; mho: string }>(sql`
        select ${col} as key, count(distinct pm.master_person_id) as people,
          count(distinct pm.master_person_id) filter (where pm.panel = 't2o') as t2o,
          count(distinct pm.master_person_id) filter (where pm.panel = 'mfr') as mfr,
          count(distinct pm.master_person_id) filter (where pm.panel = 'mho') as mho
        ${base} group by 1 order by 2 desc, 1`)
    ).rows;
    const [total] = (await db.execute<{ n: string }>(sql`select count(distinct pm.master_person_id) as n ${base}`)).rows;
    const tz =
      level === 'city'
        ? []
        : (
            await db.execute<{ key: string; n: string }>(sql`
            select coalesce(nullif(si.timezone, ''), 'unknown') as key, count(distinct pm.master_person_id) as n
            ${base} group by 1 order by 2 desc, 1 limit 8`)
          ).rows;
    const v = (x: string) => (s.hide(Number(x)) ? null : Number(x));
    return {
      dataMode: mode,
      level,
      country: f.country ?? null,
      state: f.state ?? null,
      uniquePeople: Number(total?.n ?? 0),
      rows: rows.map((r) => ({
        key: r.key,
        uniquePeople: v(r.people),
        byPanel: { t2o: v(r.t2o), mfr: v(r.mfr), mho: v(r.mho) },
        suppressed: s.hide(Number(r.people)),
      })),
      timezones: tz.map((t) => ({ key: t.key, people: v(t.n) })),
      minimumCellSize: s.minimumCellSize,
      computedAt: new Date().toISOString(),
      attributeFilters: s.resolved,
    };
  }

  /** Which panel combinations people hold, and how the five categories overlap. Never adds memberships. */
  async overlap(f: CountsRequest, mode: DataMode = this.defaultMode(), caller?: CountsCaller): Promise<OverlapResponse & { attributeFilters: unknown[] }> {
    const db = this.database.db;
    const s = await this.scope(f, mode, this.env.MIN_CELL_SIZE, caller);
    const w = this.where(mode, f, s.ids);
    const base = sql`from panel_membership pm join master_person mp on mp.id = pm.master_person_id join source_identity si on si.id = pm.source_identity_id where ${w}`;
    const combos = (
      await db.execute<{ key: string; n: string }>(sql`
        select key, count(*) as n from (
          select string_agg(distinct pm.panel::text, '+' order by pm.panel::text) as key ${base} group by pm.master_person_id
        ) x group by 1 order by 2 desc, 1`)
    ).rows;
    const matrix = (
      await db.execute<{ a: string; b: string; n: string }>(sql`
        with c as (
          select distinct cm.master_person_id as id, cm.category::text as cat from category_membership cm
          where cm.data_mode = ${mode} and exists (
            select 1 from panel_membership pm join master_person mp on mp.id = pm.master_person_id join source_identity si on si.id = pm.source_identity_id
            where pm.master_person_id = cm.master_person_id and pm.panel = cm.panel and ${w}))
        select a.cat as a, b.cat as b, count(*) as n from c a join c b on a.id = b.id group by 1, 2 order by 1, 2`)
    ).rows;
    const [total] = (await db.execute<{ n: string }>(sql`select count(distinct pm.master_person_id) as n ${base}`)).rows;
    const cell = (n: string) => ({ people: s.hide(Number(n)) ? null : Number(n), suppressed: s.hide(Number(n)) });
    return {
      dataMode: mode,
      uniquePeople: Number(total?.n ?? 0),
      panelCombinations: combos.map((c) => ({ panels: c.key.split('+'), ...cell(c.n) })),
      categoryMatrix: matrix.map((m) => ({ a: m.a, b: m.b, ...cell(m.n) })),
      minimumCellSize: s.minimumCellSize,
      computedAt: new Date().toISOString(),
      attributeFilters: s.resolved,
    };
  }
}
