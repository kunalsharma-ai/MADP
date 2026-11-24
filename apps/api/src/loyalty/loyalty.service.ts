import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  ChangeQuery,
  DataMode,
  PanelCode,
  SourceChangePage,
  SourceResponse,
  SourceReward,
} from '@madp/contracts';
import { ConnectorError, type PanelConnector } from '@madp/connectors';
import { Database } from '../db/database.js';
import {
  loyaltyAccounts,
  loyaltyReconciliations,
  rewardLedger,
  surveyParticipations,
  syncCheckpoints,
} from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { moves, positionOf, responseTarget, rewardTarget, type Bucket, type Position } from './position.js';

type Kind = 'reward' | 'response';
const STREAM: Record<Kind, string> = { reward: 'rewards', response: 'responses' };
const PAGE = 1000;
const MAX_PAGES = 1000;

export interface LoyaltySyncCounts {
  status: 'succeeded' | 'not_supported' | 'failed';
  rewardsSeen: number;
  responsesSeen: number;
  linesWritten: number;
  unmatchedMembers: number;
  unknownStatuses: number;
  message?: string;
}

interface Actor {
  id: string;
  ip: string | null;
}

/**
 * Read-only mirror of each panel's wallet. MADP never writes to a panel wallet: it follows the panel's reward rows
 * and survey responses into an append-only ledger per panel membership, holds survey completes as pending until
 * the client's approval is recorded, and reconciles against a full read of the panel's feeds.
 */
@Injectable()
export class LoyaltyService {
  private readonly log = new Logger(LoyaltyService.name);

  constructor(
    private readonly database: Database,
    private readonly registry: ConnectorRegistry,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // --- mirroring ------------------------------------------------------------------------------------------

  /**
   * Reads the rewards and responses feeds from their checkpoints (or from the beginning with `fromStart`, as a
   * full import does) and books the changes. A panel that does not serve the feeds yet is reported, not failed.
   */
  async sync(panel: PanelCode, jobId: string | null, opts: { fromStart?: boolean } = {}): Promise<LoyaltySyncCounts> {
    const { connector, dataMode } = this.registry.get(panel);
    const counts: LoyaltySyncCounts = {
      status: 'succeeded',
      rewardsSeen: 0,
      responsesSeen: 0,
      linesWritten: 0,
      unmatchedMembers: 0,
      unknownStatuses: 0,
    };
    if (!connector.rewardChanges || !connector.responseChanges)
      return { ...counts, status: 'not_supported', message: `${panel} connector has no rewards feed` };
    try {
      await this.readAll(panel, dataMode, jobId, 'reward', (q) => connector.rewardChanges!(q), opts.fromStart, async (items) => {
        counts.rewardsSeen += items.length;
        await this.book(panel, dataMode, jobId, 'reward', items, counts);
      });
      await this.readAll(panel, dataMode, jobId, 'response', (q) => connector.responseChanges!(q), opts.fromStart, async (items) => {
        counts.responsesSeen += items.length;
        await this.book(panel, dataMode, jobId, 'response', items, counts);
      });
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'not_supported')
        return { ...counts, status: 'not_supported', message: e.message };
      throw e;
    }
    return counts;
  }

  private async readAll<T>(
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string | null,
    kind: Kind,
    read: (q: ChangeQuery) => Promise<SourceChangePage<T>>,
    fromStart: boolean | undefined,
    store: (items: T[]) => Promise<void>,
  ) {
    const stream = STREAM[kind];
    const cp = fromStart
      ? null
      : await this.db.query.syncCheckpoints.findFirst({
          where: and(eq(syncCheckpoints.dataMode, dataMode), eq(syncCheckpoints.panel, panel), eq(syncCheckpoints.stream, stream)),
        });
    let cursor = cp?.cursor ?? null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await read({ cursor, since: null, limit: PAGE });
      if (res.items.length) await store(res.items);
      cursor = res.cursor;
      await this.db
        .insert(syncCheckpoints)
        .values({ dataMode, panel, stream, cursor, lastJobId: jobId, lastSuccessAt: res.more ? null : new Date() })
        .onConflictDoUpdate({
          target: [syncCheckpoints.dataMode, syncCheckpoints.panel, syncCheckpoints.stream],
          set: { cursor, lastJobId: jobId, updatedAt: new Date(), ...(res.more ? {} : { lastSuccessAt: new Date() }) },
        });
      if (!res.more) break;
    }
  }

  /** Accounts for the members of a page, by source member id. Members MADP does not know yet are left out. */
  private async accountsFor(panel: PanelCode, dataMode: DataMode, memberIds: string[]) {
    const ids = [...new Set(memberIds)];
    const out = new Map<string, { accountId: string; membershipId: string }>();
    if (!ids.length) return out;
    const list = `{${ids.map((i) => `"${i.replace(/["\\]/g, '')}"`).join(',')}}`;
    await this.db.execute(sql`
      insert into loyalty_account (data_mode, panel, panel_membership_id, source_member_id)
      select ${dataMode}, ${panel}, pm.id, si.source_member_id
      from source_identity si join panel_membership pm on pm.source_identity_id = si.id
      where si.data_mode = ${dataMode} and si.panel = ${panel} and si.source_member_id = any(${list}::text[])
      on conflict do nothing`);
    const rows = await this.db.execute<{ id: string; membership: string; member: string }>(sql`
      select la.id, la.panel_membership_id as membership, la.source_member_id as member from loyalty_account la
      where la.data_mode = ${dataMode} and la.panel = ${panel} and la.source_member_id = any(${list}::text[])`);
    for (const r of rows.rows) out.set(r.member, { accountId: r.id, membershipId: r.membership });
    return out;
  }

  /** Current position and last line number of each source row. */
  private async positions(panel: PanelCode, dataMode: DataMode, kind: Kind, refs: string[]) {
    const out = new Map<string, { position: Position; seq: number }>();
    if (!refs.length) return out;
    const rows = await this.db.execute<{ ref: string; bucket: Bucket; points: string; seq: number }>(sql`
      select source_ref as ref, bucket, sum(points) as points, max(seq) as seq from reward_ledger
      where data_mode = ${dataMode} and panel = ${panel} and source_kind = ${kind}
        and source_ref = any(${`{${refs.map((r) => `"${r.replace(/["\\]/g, '')}"`).join(',')}}`}::text[])
      group by source_ref, bucket`);
    const sums = new Map<string, { b: Partial<Record<Bucket, number>>; seq: number }>();
    for (const r of rows.rows) {
      const s = sums.get(r.ref) ?? { b: {}, seq: 0 };
      s.b[r.bucket] = Number(r.points);
      s.seq = Math.max(s.seq, Number(r.seq));
      sums.set(r.ref, s);
    }
    for (const [ref, s] of sums) out.set(ref, { position: positionOf(s.b), seq: s.seq });
    return out;
  }

  private refOf(kind: Kind, item: SourceReward | SourceResponse) {
    return kind === 'reward' ? (item as SourceReward).sourceRewardId : (item as SourceResponse).sourceResponseId;
  }

  private target(kind: Kind, item: SourceReward | SourceResponse, current: Position) {
    if (kind === 'reward') return rewardTarget(item as SourceReward);
    return { ...responseTarget(item as SourceResponse, current), unknownStatus: false };
  }

  /** Books one page: appends the lines that bring each row to its target, and keeps survey participation. */
  private async book(
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string | null,
    kind: Kind,
    items: (SourceReward | SourceResponse)[],
    counts: LoyaltySyncCounts,
  ) {
    // The latest version of each row in the page wins.
    const latest = new Map<string, SourceReward | SourceResponse>();
    for (const i of items) latest.set(this.refOf(kind, i), i);
    const accounts = await this.accountsFor(panel, dataMode, [...latest.values()].map((i) => i.sourceMemberId));
    const current = await this.positions(panel, dataMode, kind, [...latest.keys()]);
    const lines: (typeof rewardLedger.$inferInsert)[] = [];
    const parts: (typeof surveyParticipations.$inferInsert)[] = [];
    for (const [ref, item] of latest) {
      const acct = accounts.get(item.sourceMemberId);
      if (!acct) {
        counts.unmatchedMembers++;
        continue;
      }
      const cur = current.get(ref) ?? { position: { bucket: null, points: 0 }, seq: 0 };
      const t = this.target(kind, item, cur.position);
      if (t.unknownStatus) counts.unknownStatuses++;
      let seq = cur.seq;
      for (const m of moves(cur.position, t))
        lines.push(this.line(panel, dataMode, acct.accountId, kind, ref, ++seq, m, 'mirror', item, jobId));
      if (kind === 'response') {
        const r = item as SourceResponse;
        parts.push({
          dataMode,
          panel,
          panelMembershipId: acct.membershipId,
          sourceResponseId: r.sourceResponseId,
          surveySlug: r.surveySlug,
          status: r.isDeleted ? 'deleted' : r.status,
          points: r.points,
          loi: r.loi,
          source: r.source,
          startedAt: r.startedAt ? new Date(r.startedAt) : null,
          endedAt: r.endedAt ? new Date(r.endedAt) : null,
          sourceUpdatedAt: r.sourceUpdatedAt ? new Date(r.sourceUpdatedAt) : null,
        });
      }
    }
    for (let i = 0; i < lines.length; i += 1000) {
      const written = await this.db.insert(rewardLedger).values(lines.slice(i, i + 1000)).onConflictDoNothing().returning({ id: rewardLedger.id });
      counts.linesWritten += written.length;
    }
    for (let i = 0; i < parts.length; i += 1000)
      await this.db
        .insert(surveyParticipations)
        .values(parts.slice(i, i + 1000))
        .onConflictDoUpdate({
          target: [surveyParticipations.dataMode, surveyParticipations.panel, surveyParticipations.sourceResponseId],
          set: {
            panelMembershipId: sql`excluded.panel_membership_id`,
            surveySlug: sql`excluded.survey_slug`,
            status: sql`excluded.status`,
            points: sql`excluded.points`,
            loi: sql`excluded.loi`,
            source: sql`excluded.source`,
            startedAt: sql`excluded.started_at`,
            endedAt: sql`excluded.ended_at`,
            sourceUpdatedAt: sql`excluded.source_updated_at`,
            updatedAt: new Date(),
          },
        });
  }

  private line(
    panel: PanelCode,
    dataMode: DataMode,
    accountId: string,
    kind: Kind,
    ref: string,
    seq: number,
    m: { bucket: Bucket; points: number },
    entryKind: 'mirror' | 'approval',
    item: SourceReward | SourceResponse | null,
    jobId: string | null,
    extra: { category?: string; reference?: string | null; decidedBy?: string; note?: string | null } = {},
  ): typeof rewardLedger.$inferInsert {
    const reward = kind === 'reward' ? (item as SourceReward | null) : null;
    const response = kind === 'response' ? (item as SourceResponse | null) : null;
    return {
      dataMode,
      panel,
      accountId,
      sourceKind: kind,
      sourceRef: ref,
      seq,
      bucket: m.bucket,
      points: m.points,
      entryKind,
      category: extra.category ?? (reward ? reward.category : 'survey'),
      reference: extra.reference ?? (reward ? reward.profileSlug : (response?.surveySlug ?? null)),
      sourceStatus: item ? (reward ? reward.status : response!.isDeleted ? 'deleted' : response!.status) : null,
      sourceUpdatedAt: item?.sourceUpdatedAt ? new Date(item.sourceUpdatedAt) : null,
      importJobId: jobId,
      decidedBy: extra.decidedBy ?? null,
      note: extra.note ?? null,
    };
  }

  /** A removed member's survey history goes; the ledger stays, because reward liabilities must stay auditable. */
  async forgetParticipation(membershipId: string) {
    await this.db.delete(surveyParticipations).where(eq(surveyParticipations.panelMembershipId, membershipId));
  }

  // --- approvals ------------------------------------------------------------------------------------------

  /**
   * Records the client's approval of a survey's completes on one panel: every complete of that survey still
   * pending moves to approved. Only MADP's ledger changes; the panel wallet is not touched.
   */
  async approveSurvey(mode: DataMode, panel: PanelCode, surveySlug: string, note: string, actor: Actor) {
    const rows = await this.db.execute<{ ref: string; account: string; pending: string; seq: number }>(sql`
      select source_ref as ref, min(account_id::text) as account,
        sum(points) filter (where bucket = 'pending') as pending, max(seq) as seq
      from reward_ledger
      where data_mode = ${mode} and panel = ${panel} and source_kind = 'response' and reference = ${surveySlug}
      group by source_ref
      having coalesce(sum(points) filter (where bucket = 'pending'), 0) > 0`);
    const lines: (typeof rewardLedger.$inferInsert)[] = [];
    let points = 0;
    for (const r of rows.rows) {
      const p = Number(r.pending);
      points += p;
      const extra = { category: 'survey', reference: surveySlug, decidedBy: actor.id, note };
      lines.push(this.line(panel, mode, r.account, 'response', r.ref, Number(r.seq) + 1, { bucket: 'pending', points: -p }, 'approval', null, null, extra));
      lines.push(this.line(panel, mode, r.account, 'response', r.ref, Number(r.seq) + 2, { bucket: 'approved', points: p }, 'approval', null, null, extra));
    }
    if (!lines.length) throw new ConflictException(`No pending completes of ${surveySlug} on ${panel.toUpperCase()}`);
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < lines.length; i += 1000) await tx.insert(rewardLedger).values(lines.slice(i, i + 1000));
    });
    const result = { panel, surveySlug, completes: rows.rows.length, points };
    await this.audit.record({
      actorId: actor.id,
      actorType: 'admin',
      action: 'loyalty.survey_approved',
      targetType: 'panel',
      targetId: panel,
      metadata: { ...result, note },
      ip: actor.ip,
    });
    return result;
  }

  // --- reads ----------------------------------------------------------------------------------------------

  /** Balances per bucket, per panel. Points only: the panels do not record a money value for a point. */
  async liability(mode: DataMode, panel?: PanelCode) {
    const filter = panel ? sql`and l.panel = ${panel}` : sql``;
    const totals = await this.db.execute<{ panel: PanelCode; bucket: Bucket; points: string }>(sql`
      select l.panel, l.bucket, sum(l.points) as points from reward_ledger l
      where l.data_mode = ${mode} ${filter} group by l.panel, l.bucket`);
    const accounts = await this.db.execute<{ panel: PanelCode; n: string }>(sql`
      select la.panel, count(*) as n from loyalty_account la
      where la.data_mode = ${mode} ${panel ? sql`and la.panel = ${panel}` : sql``} group by la.panel`);
    const byCategory = await this.db.execute<{ panel: PanelCode; category: string; points: string }>(sql`
      select l.panel, l.category, sum(l.points) as points from reward_ledger l
      where l.data_mode = ${mode} and l.bucket = 'approved' ${filter} group by l.panel, l.category`);
    const pendingSurveys = await this.db.execute<{ panel: PanelCode; survey: string; points: string; completes: string }>(sql`
      select panel, survey, sum(p) as points, count(*) as completes from (
        select l.panel, l.reference as survey, l.source_ref, sum(l.points) as p from reward_ledger l
        where l.data_mode = ${mode} and l.source_kind = 'response' and l.bucket = 'pending' ${filter}
        group by l.panel, l.reference, l.source_ref having sum(l.points) > 0) x
      group by panel, survey order by points desc limit 50`);
    const checkpoints = await this.db.execute<{ panel: PanelCode; stream: string; at: Date | null }>(sql`
      select panel, stream, last_success_at as at from sync_checkpoint
      where data_mode = ${mode} and stream in ('rewards', 'responses') ${panel ? sql`and panel = ${panel}` : sql``}`);
    const panels = [...new Set([...totals.rows.map((r) => r.panel), ...accounts.rows.map((r) => r.panel)])].sort();
    return {
      dataMode: mode,
      unit: 'points',
      note: 'Points only. Survey completes stay pending until the client approval is recorded. No panel records redemptions yet.',
      panels: panels.map((p) => {
        const b = (k: Bucket) => Number(totals.rows.find((r) => r.panel === p && r.bucket === k)?.points ?? 0);
        return {
          panel: p,
          accounts: Number(accounts.rows.find((r) => r.panel === p)?.n ?? 0),
          approved: b('approved'),
          pending: b('pending'),
          reversed: b('reversed'),
          redeemed: b('redeemed'),
          outstanding: b('approved'),
          approvedByCategory: Object.fromEntries(byCategory.rows.filter((r) => r.panel === p).map((r) => [r.category, Number(r.points)])),
          pendingBySurvey: pendingSurveys.rows
            .filter((r) => r.panel === p)
            .map((r) => ({ survey: r.survey, completes: Number(r.completes), points: Number(r.points) })),
          lastSync: Object.fromEntries(checkpoints.rows.filter((r) => r.panel === p).map((r) => [r.stream, r.at])),
        };
      }),
    };
  }

  /** One person's wallets, one per panel membership and never added together, with their latest lines. */
  async person(personId: string, limit = 100) {
    const accounts = await this.db.execute<{ id: string; panel: PanelCode; data_mode: DataMode; membership_status: string }>(sql`
      select la.id, la.panel, la.data_mode, pm.status as membership_status from loyalty_account la
      join panel_membership pm on pm.id = la.panel_membership_id where pm.master_person_id = ${personId}
      order by la.panel`);
    const out = [];
    for (const a of accounts.rows) {
      const sums = await this.db.execute<{ bucket: Bucket; points: string }>(sql`
        select bucket, sum(points) as points from reward_ledger where account_id = ${a.id} group by bucket`);
      const lines = await this.db
        .select({
          id: rewardLedger.id,
          sourceKind: rewardLedger.sourceKind,
          seq: rewardLedger.seq,
          bucket: rewardLedger.bucket,
          points: rewardLedger.points,
          entryKind: rewardLedger.entryKind,
          category: rewardLedger.category,
          reference: rewardLedger.reference,
          sourceStatus: rewardLedger.sourceStatus,
          sourceUpdatedAt: rewardLedger.sourceUpdatedAt,
          recordedAt: rewardLedger.recordedAt,
          note: rewardLedger.note,
        })
        .from(rewardLedger)
        .where(eq(rewardLedger.accountId, a.id))
        .orderBy(desc(rewardLedger.recordedAt), desc(rewardLedger.id))
        .limit(limit);
      const b = (k: Bucket) => Number(sums.rows.find((r) => r.bucket === k)?.points ?? 0);
      const participation = await this.db.execute<{ status: string; n: string }>(sql`
        select sp.status, count(*) as n from survey_participation sp
        join loyalty_account la on la.panel_membership_id = sp.panel_membership_id where la.id = ${a.id} group by sp.status`);
      out.push({
        panel: a.panel,
        dataMode: a.data_mode,
        membershipStatus: a.membership_status,
        balances: { approved: b('approved'), pending: b('pending'), reversed: b('reversed'), redeemed: b('redeemed') },
        surveys: Object.fromEntries(participation.rows.map((r) => [r.status, Number(r.n)])),
        lines,
      });
    }
    return { accounts: out };
  }

  // --- reconciliation -------------------------------------------------------------------------------------

  /**
   * Reads both feeds of one panel in full and compares every row with the ledger: rows MADP is missing, rows
   * whose position differs, rows of members MADP does not know, and positions MADP holds that the panel no
   * longer has. Also compares the panel's own balance rule (credited rewards plus complete survey points) with
   * MADP's approved plus pending. With `repair`, books what is missing or different, reverses what the panel no
   * longer has, and reports again.
   */
  async reconcile(panel: PanelCode, repair: boolean, actor: Actor) {
    const { connector, dataMode } = this.registry.get(panel);
    if (!connector.rewardChanges || !connector.responseChanges)
      throw new NotFoundException(`${panel} connector has no rewards feed`);
    let report = await this.compare(panel, dataMode, connector);
    if (repair && (report.missing + report.different + report.onlyInMadp > 0)) {
      const counts: LoyaltySyncCounts = { status: 'succeeded', rewardsSeen: 0, responsesSeen: 0, linesWritten: 0, unmatchedMembers: 0, unknownStatuses: 0 };
      await this.book(panel, dataMode, null, 'reward', report.source.rewards, counts);
      await this.book(panel, dataMode, null, 'response', report.source.responses, counts);
      await this.reverseGone(panel, dataMode, report.goneRefs);
      report = { ...(await this.compare(panel, dataMode, connector)), repairedLines: counts.linesWritten } as typeof report;
    }
    const { source: _s, goneRefs: _g, ...summary } = report;
    void _s;
    void _g;
    const [row] = await this.db
      .insert(loyaltyReconciliations)
      .values({ dataMode, panel, repaired: repair, report: summary, requestedBy: actor.id })
      .returning({ id: loyaltyReconciliations.id, at: loyaltyReconciliations.at });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'admin',
      action: repair ? 'loyalty.reconciled_and_repaired' : 'loyalty.reconciled',
      targetType: 'panel',
      targetId: panel,
      metadata: { ...summary, samples: undefined },
      ip: actor.ip,
    });
    return { id: row!.id, at: row!.at, panel, dataMode, repaired: repair, ...summary };
  }

  async reconciliations(mode: DataMode, panel?: PanelCode) {
    return this.db
      .select()
      .from(loyaltyReconciliations)
      .where(and(eq(loyaltyReconciliations.dataMode, mode), panel ? eq(loyaltyReconciliations.panel, panel) : sql`true`))
      .orderBy(desc(loyaltyReconciliations.at))
      .limit(50);
  }

  private async readFull<T>(read: (q: ChangeQuery) => Promise<SourceChangePage<T>>) {
    const all: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res: SourceChangePage<T> = await read({ cursor, since: null, limit: PAGE });
      all.push(...res.items);
      cursor = res.cursor;
      if (!res.more) break;
    }
    return all;
  }

  private async compare(panel: PanelCode, dataMode: DataMode, connector: PanelConnector) {
    const rewards = [...new Map((await this.readFull((q) => connector.rewardChanges!(q))).map((r) => [r.sourceRewardId, r])).values()];
    const responses = [...new Map((await this.readFull((q) => connector.responseChanges!(q))).map((r) => [r.sourceResponseId, r])).values()];
    const known = await this.db.execute<{ member: string }>(sql`
      select source_member_id as member from source_identity where data_mode = ${dataMode} and panel = ${panel}`);
    const members = new Set(known.rows.map((r) => r.member));
    const samples: Record<string, string[]> = { missing: [], different: [], unmatched: [], onlyInMadp: [] };
    const note = (k: string, ref: string) => samples[k]!.length < 20 && samples[k]!.push(ref);
    let missing = 0;
    let different = 0;
    let unmatched = 0;
    let panelBalance = 0;
    const seen: Record<Kind, Set<string>> = { reward: new Set(), response: new Set() };
    for (const [kind, list] of [['reward', rewards], ['response', responses]] as const) {
      const pos = await this.positionsAll(panel, dataMode, kind);
      for (const item of list as (SourceReward | SourceResponse)[]) {
        const ref = this.refOf(kind, item);
        seen[kind].add(ref);
        // The panel's own balance rule (routes/api/Me.js): credited rewards plus complete survey points.
        if (kind === 'reward' ? (item as SourceReward).status === 'credited' : (item as SourceResponse).status === 'complete' && !(item as SourceResponse).isDeleted)
          panelBalance += item.points;
        if (!members.has(item.sourceMemberId)) {
          unmatched++;
          note('unmatched', ref);
          continue;
        }
        const cur = pos.get(ref) ?? { bucket: null, points: 0 };
        const t = this.target(kind, item, cur);
        if (moves(cur, t).length === 0) continue;
        if (cur.bucket === null) {
          missing++;
          note('missing', ref);
        } else {
          different++;
          note('different', ref);
        }
      }
    }
    const goneRefs: { kind: Kind; ref: string }[] = [];
    for (const kind of ['reward', 'response'] as const)
      for (const [ref, p] of await this.positionsAll(panel, dataMode, kind))
        if (!seen[kind].has(ref) && p.bucket && p.bucket !== 'reversed') {
          goneRefs.push({ kind, ref });
          note('onlyInMadp', ref);
        }
    const [t] = (
      await this.db.execute<{ approved: string; pending: string }>(sql`
        select coalesce(sum(points) filter (where bucket = 'approved'), 0) as approved,
          coalesce(sum(points) filter (where bucket = 'pending'), 0) as pending
        from reward_ledger where data_mode = ${dataMode} and panel = ${panel}`)
    ).rows;
    const madpBalance = Number(t!.approved) + Number(t!.pending);
    return {
      sourceRewards: rewards.length,
      sourceResponses: responses.length,
      missing,
      different,
      unmatched,
      onlyInMadp: goneRefs.length,
      panelBalance,
      madpApproved: Number(t!.approved),
      madpPending: Number(t!.pending),
      balanceDifference: panelBalance - madpBalance,
      matches: missing + different + goneRefs.length === 0,
      samples,
      repairedLines: 0,
      source: { rewards, responses },
      goneRefs,
    };
  }

  private async positionsAll(panel: PanelCode, dataMode: DataMode, kind: Kind) {
    const rows = await this.db.execute<{ ref: string; bucket: Bucket; points: string }>(sql`
      select source_ref as ref, bucket, sum(points) as points from reward_ledger
      where data_mode = ${dataMode} and panel = ${panel} and source_kind = ${kind} group by source_ref, bucket`);
    const sums = new Map<string, Partial<Record<Bucket, number>>>();
    for (const r of rows.rows) {
      const s = sums.get(r.ref) ?? {};
      s[r.bucket] = Number(r.points);
      sums.set(r.ref, s);
    }
    return new Map([...sums].map(([ref, s]) => [ref, positionOf(s)]));
  }

  /** Reverses positions the panel no longer has (the row is gone from its feed). */
  private async reverseGone(panel: PanelCode, dataMode: DataMode, gone: { kind: Kind; ref: string }[]) {
    for (const kind of ['reward', 'response'] as const) {
      const refs = gone.filter((g) => g.kind === kind).map((g) => g.ref);
      if (!refs.length) continue;
      const pos = await this.positions(panel, dataMode, kind, refs);
      const acct = await this.db.execute<{ ref: string; account: string; category: string; reference: string | null }>(sql`
        select distinct on (source_ref) source_ref as ref, account_id as account, category, reference from reward_ledger
        where data_mode = ${dataMode} and panel = ${panel} and source_kind = ${kind}
          and source_ref = any(${`{${refs.map((r) => `"${r.replace(/["\\]/g, '')}"`).join(',')}}`}::text[])
        order by source_ref, seq`);
      const lines: (typeof rewardLedger.$inferInsert)[] = [];
      for (const a of acct.rows) {
        const cur = pos.get(a.ref)!;
        let seq = cur.seq;
        for (const m of moves(cur.position, { bucket: null, points: 0 }))
          lines.push(
            this.line(panel, dataMode, a.account, kind, a.ref, ++seq, m, 'mirror', null, null, {
              category: a.category,
              reference: a.reference,
              note: 'No longer in the panel feed (reconciliation)',
            }),
          );
      }
      if (lines.length) await this.db.insert(rewardLedger).values(lines).onConflictDoNothing();
    }
  }
}
