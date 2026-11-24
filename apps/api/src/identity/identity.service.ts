import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DataMode, IdentityCandidateQuery, PanelCode } from '@madp/contracts';
import { Database, type Db } from '../db/database.js';
import {
  identityLinkEvents,
  identityMatchCandidates,
  masterPersons,
  panelMemberships,
  sourceIdentities,
} from '../db/schema.js';
import { Mongo } from '../mongo/mongo.js';
import { AuditService } from '../audit/audit.service.js';
import { recomputePerson } from './precedence.js';

interface Actor {
  id: string;
  ip: string | null;
}

/**
 * Merges and unmerges of source identities between master persons. A move takes the identity's panel membership,
 * that panel's category memberships and consents, and that panel's answers with it. Nothing from other panels moves,
 * and panel reward balances and communications are never combined.
 *
 * Postgres and MongoDB cannot share a transaction. Postgres changes first; the answers in MongoDB are then pointed at
 * whatever person Postgres says owns the identity, keyed by (data mode, panel, source member id), so repeating that
 * step is always safe (see `repairAnswerOwners`).
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly database: Database,
    private readonly mongo: Mongo,
    private readonly audit: AuditService,
  ) {}

  async candidates(mode: DataMode, q: IdentityCandidateQuery) {
    const db = this.database.db;
    const rows = await db
      .select({
        id: identityMatchCandidates.id,
        rule: identityMatchCandidates.rule,
        status: identityMatchCandidates.status,
        createdAt: identityMatchCandidates.createdAt,
        decidedAt: identityMatchCandidates.decidedAt,
        candidatePersonId: identityMatchCandidates.candidatePersonId,
        identityId: sourceIdentities.id,
        panel: sourceIdentities.panel,
        sourceCategory: sourceIdentities.sourceCategory,
        emailMasked: sourceIdentities.emailMasked,
        emailVerification: sourceIdentities.emailVerification,
        personId: sourceIdentities.masterPersonId,
      })
      .from(identityMatchCandidates)
      .innerJoin(sourceIdentities, eq(sourceIdentities.id, identityMatchCandidates.sourceIdentityId))
      .where(
        and(
          eq(identityMatchCandidates.dataMode, mode),
          eq(identityMatchCandidates.status, q.status),
          q.panel ? eq(sourceIdentities.panel, q.panel) : sql`true`,
        ),
      )
      .orderBy(asc(identityMatchCandidates.createdAt))
      .limit(q.limit);
    const personIds = [...new Set(rows.map((r) => r.candidatePersonId))];
    const others = personIds.length
      ? await db
          .select({
            personId: sourceIdentities.masterPersonId,
            id: sourceIdentities.id,
            panel: sourceIdentities.panel,
            sourceCategory: sourceIdentities.sourceCategory,
            emailMasked: sourceIdentities.emailMasked,
            emailVerification: sourceIdentities.emailVerification,
          })
          .from(sourceIdentities)
          .where(inArray(sourceIdentities.masterPersonId, personIds))
      : [];
    const totals = await db.execute<{ status: string; n: string }>(
      sql`select status::text, count(*) as n from identity_match_candidate where data_mode = ${mode} group by 1`,
    );
    return {
      dataMode: mode,
      totals: Object.fromEntries(totals.rows.map((r) => [r.status, Number(r.n)])),
      items: rows.map((r) => ({
        id: r.id,
        rule: r.rule,
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        linked: r.personId === r.candidatePersonId,
        identity: {
          id: r.identityId,
          personId: r.personId,
          panel: r.panel,
          sourceCategory: r.sourceCategory,
          emailMasked: r.emailMasked,
          emailVerification: r.emailVerification,
        },
        candidate: {
          personId: r.candidatePersonId,
          identities: others
            .filter((o) => o.personId === r.candidatePersonId && o.id !== r.identityId)
            .map(({ personId: _p, ...o }) => o),
        },
      })),
    };
  }

  /** Approve merges the identity into the candidate person; reject leaves both people as they are. */
  async decide(candidateId: string, decision: 'approve' | 'reject', reason: string | undefined, actor: Actor) {
    const db = this.database.db;
    const c = await db.query.identityMatchCandidates.findFirst({
      where: eq(identityMatchCandidates.id, candidateId),
    });
    if (!c) throw new NotFoundException();
    if (c.status !== 'pending') throw new ConflictException(`This match was already ${c.status}`);
    if (decision === 'reject') {
      await db
        .update(identityMatchCandidates)
        .set({ status: 'rejected', decidedBy: actor.id, decidedAt: new Date() })
        .where(and(eq(identityMatchCandidates.id, c.id), eq(identityMatchCandidates.status, 'pending')));
      await this.audit.record({
        actorId: actor.id,
        actorType: 'admin',
        action: 'identity.match_rejected',
        targetType: 'identity_match_candidate',
        targetId: c.id,
        metadata: { reason: reason ?? null },
        ip: actor.ip,
      });
      return { status: 'rejected' as const };
    }
    const moved = await db.transaction(async (tx) => {
      // Lock the candidate so two reviewers cannot both merge it.
      const locked = await tx.execute<{ status: string }>(
        sql`select status::text from identity_match_candidate where id = ${c.id} for update`,
      );
      if (locked.rows[0]?.status !== 'pending') throw new ConflictException('This match was already decided');
      const r = await this.move(tx, c.sourceIdentityId, c.candidatePersonId, 'merge', reason ?? null, actor, c.id);
      await tx
        .update(identityMatchCandidates)
        .set({ status: 'approved', decidedBy: actor.id, decidedAt: new Date() })
        .where(eq(identityMatchCandidates.id, c.id));
      return r;
    });
    const answersMoved = await this.repairAnswerOwners(moved.identity);
    await this.audit.record({
      actorId: actor.id,
      actorType: 'admin',
      action: 'identity.merged',
      targetType: 'master_person',
      targetId: moved.toPersonId,
      metadata: {
        candidateId: c.id,
        sourceIdentityId: c.sourceIdentityId,
        panel: moved.identity.panel,
        fromPersonId: moved.fromPersonId,
        answersMoved,
        reason: reason ?? null,
      },
      ip: actor.ip,
    });
    return { status: 'approved' as const, personId: moved.toPersonId, fromPersonId: moved.fromPersonId, answersMoved };
  }

  /**
   * Takes one identity out of its person. It goes back to the person it came from when that person is still empty
   * (so the old id is restored), otherwise to a new person. Works for automatic links as well as reviewed ones.
   */
  async unlink(identityId: string, reason: string, actor: Actor) {
    const db = this.database.db;
    const identity = await db.query.sourceIdentities.findFirst({ where: eq(sourceIdentities.id, identityId) });
    if (!identity) throw new NotFoundException();
    const moved = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from master_person where id = ${identity.masterPersonId} for update`);
      const siblings = await tx
        .select({ id: sourceIdentities.id })
        .from(sourceIdentities)
        .where(and(eq(sourceIdentities.masterPersonId, identity.masterPersonId), ne(sourceIdentities.id, identityId)));
      if (!siblings.length)
        throw new ConflictException('This is the only identity of its person; there is nothing to unmerge');
      // The person this identity was last merged away from, if it is still empty.
      const lastMerge = await tx
        .select({ fromPersonId: identityLinkEvents.fromPersonId })
        .from(identityLinkEvents)
        .where(and(eq(identityLinkEvents.sourceIdentityId, identityId), eq(identityLinkEvents.action, 'merge')))
        .orderBy(desc(identityLinkEvents.createdAt))
        .limit(1);
      let target = lastMerge[0]?.fromPersonId;
      if (target) {
        const [{ n } = { n: '1' }] = (
          await tx.execute<{ n: string }>(
            sql`select count(*) as n from source_identity where master_person_id = ${target}`,
          )
        ).rows;
        if (Number(n) > 0) target = undefined;
      }
      if (!target) {
        const [p] = await tx
          .insert(masterPersons)
          .values({ dataMode: identity.dataMode })
          .returning({ id: masterPersons.id });
        target = p!.id;
      }
      const r = await this.move(tx, identityId, target, 'unmerge', reason, actor, null);
      // An approved match for this identity no longer holds.
      await tx
        .update(identityMatchCandidates)
        .set({ status: 'rejected', decidedBy: actor.id, decidedAt: new Date() })
        .where(
          and(
            eq(identityMatchCandidates.sourceIdentityId, identityId),
            eq(identityMatchCandidates.status, 'approved'),
          ),
        );
      return r;
    });
    const answersMoved = await this.repairAnswerOwners(moved.identity);
    await this.audit.record({
      actorId: actor.id,
      actorType: 'admin',
      action: 'identity.unmerged',
      targetType: 'master_person',
      targetId: moved.fromPersonId,
      metadata: {
        sourceIdentityId: identityId,
        panel: moved.identity.panel,
        toPersonId: moved.toPersonId,
        answersMoved,
        reason,
      },
      ip: actor.ip,
    });
    return { personId: moved.toPersonId, fromPersonId: moved.fromPersonId, answersMoved };
  }

  async history(personId: string) {
    return this.database.db
      .select({
        id: identityLinkEvents.id,
        action: identityLinkEvents.action,
        sourceIdentityId: identityLinkEvents.sourceIdentityId,
        panel: sourceIdentities.panel,
        fromPersonId: identityLinkEvents.fromPersonId,
        toPersonId: identityLinkEvents.toPersonId,
        candidateId: identityLinkEvents.candidateId,
        reason: identityLinkEvents.reason,
        actorId: identityLinkEvents.actorId,
        createdAt: identityLinkEvents.createdAt,
      })
      .from(identityLinkEvents)
      .innerJoin(sourceIdentities, eq(sourceIdentities.id, identityLinkEvents.sourceIdentityId))
      .where(
        sql`${identityLinkEvents.fromPersonId} = ${personId} or ${identityLinkEvents.toPersonId} = ${personId}`,
      )
      .orderBy(asc(identityLinkEvents.createdAt));
  }

  /** Points this identity's answers and answer history at the person that owns it in Postgres. Idempotent. */
  async repairAnswerOwners(identity: {
    id: string;
    dataMode: DataMode;
    panel: PanelCode;
    sourceMemberId: string;
  }): Promise<number> {
    const current = await this.database.db.query.sourceIdentities.findFirst({
      where: eq(sourceIdentities.id, identity.id),
      columns: { masterPersonId: true },
    });
    if (!current) return 0;
    const key = { dataMode: identity.dataMode, panel: identity.panel, sourceMemberId: identity.sourceMemberId };
    const set = { $set: { personId: current.masterPersonId } };
    const a = await this.mongo.profileAnswers.updateMany(
      { ...key, personId: { $ne: current.masterPersonId } },
      set,
    );
    await this.mongo.answerHistory.updateMany({ ...key, personId: { $ne: current.masterPersonId } }, set);
    return a.modifiedCount;
  }

  private async move(
    tx: Db,
    identityId: string,
    toPersonId: string,
    action: 'merge' | 'unmerge',
    reason: string | null,
    actor: Actor,
    candidateId: string | null,
  ) {
    const identity = await tx.query.sourceIdentities.findFirst({ where: eq(sourceIdentities.id, identityId) });
    if (!identity) throw new NotFoundException();
    const fromPersonId = identity.masterPersonId;
    if (fromPersonId === toPersonId) throw new ConflictException('This identity already belongs to that person');
    const to = await tx.query.masterPersons.findFirst({ where: eq(masterPersons.id, toPersonId) });
    if (!to || to.dataMode !== identity.dataMode) throw new NotFoundException('Person not found');
    if (action === 'merge' && to.status === 'merged')
      throw new ConflictException('That person has since been merged into another one; review the newer match');
    // One live account per panel per person: two accounts on the same panel stay two memberships of two people.
    const clash = await tx
      .select({ id: panelMemberships.id })
      .from(panelMemberships)
      .where(
        and(
          eq(panelMemberships.masterPersonId, toPersonId),
          eq(panelMemberships.panel, identity.panel),
          ne(panelMemberships.status, 'deleted'),
        ),
      )
      .limit(1);
    if (clash.length)
      throw new ConflictException(
        `That person already has a ${identity.panel.toUpperCase()} membership; accounts on the same panel are not merged`,
      );
    const p = identity.panel;
    await tx
      .update(sourceIdentities)
      .set({ masterPersonId: toPersonId, updatedAt: new Date() })
      .where(eq(sourceIdentities.id, identityId));
    await tx
      .update(panelMemberships)
      .set({ masterPersonId: toPersonId, updatedAt: new Date() })
      .where(eq(panelMemberships.sourceIdentityId, identityId));
    // This panel's categories and consents follow the identity. A leftover row of a deleted account on the same
    // panel gives way to the moving one.
    await tx.execute(sql`
      delete from category_membership t using category_membership f
      where t.master_person_id = ${toPersonId} and f.master_person_id = ${fromPersonId}
        and t.panel = ${p} and f.panel = ${p} and t.category = f.category`);
    await tx.execute(sql`
      update category_membership set master_person_id = ${toPersonId}
      where master_person_id = ${fromPersonId} and panel = ${p}`);
    await tx.execute(sql`
      delete from consent_record t using consent_record f
      where t.master_person_id = ${toPersonId} and f.master_person_id = ${fromPersonId}
        and t.panel = ${p} and f.panel = ${p} and t.purpose = f.purpose and t.data_mode = f.data_mode`);
    await tx.execute(sql`
      update consent_record set master_person_id = ${toPersonId}
      where master_person_id = ${fromPersonId} and panel = ${p}`);
    await tx.insert(identityLinkEvents).values({
      dataMode: identity.dataMode,
      action,
      sourceIdentityId: identityId,
      fromPersonId,
      toPersonId,
      candidateId,
      reason,
      actorId: actor.id,
    });
    await recomputePerson(tx, fromPersonId);
    await recomputePerson(tx, toPersonId);
    return { identity, fromPersonId, toPersonId };
  }
}
