import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type {
  NetworkAnswer,
  NetworkDeletion,
  NetworkMember,
  NetworkPush,
  NetworkQuestion,
  NetworkStatus,
  PanelCode,
  SourceAnswer,
  SourceDeletion,
  SourceOption,
  SourceQuestion,
  SourceRespondent,
} from '@madp/contracts';
import { Database } from '../db/database.js';
import { networkBatches, networkPushKeys, networkRecords } from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';

export type InboxKind = 'member' | 'answer' | 'question' | 'deletion';
type StoredQuestion = SourceQuestion & { options: SourceOption[] };

/** Turns what a network sends into the shapes the sync already reads from T2O, MFR and MHO. */
export function toSource(panel: PanelCode) {
  return {
    member: (m: NetworkMember): SourceRespondent => ({
      panel,
      sourceMemberId: m.memberId,
      sourceRespondentRef: null,
      sourceCategory: m.category.toLowerCase(),
      email: m.email,
      phone: m.phone,
      firstName: m.firstName,
      lastName: m.lastName,
      gender: m.gender,
      dateOfBirth: m.dateOfBirth,
      country: m.country,
      state: m.state,
      city: m.city,
      timezone: null,
      emailVerification: m.emailVerified ? 'verified' : 'unverified',
      phoneVerification: m.phoneVerified ? 'verified' : 'unverified',
      qualityScore: null,
      isActive: m.active,
      sourceCreatedAt: m.createdAt,
      sourceUpdatedAt: m.updatedAt,
      consents: m.marketingConsent
        ? [
            {
              purpose: 'email_marketing',
              status: m.marketingConsent,
              capturedAt: m.updatedAt,
              evidence: { field: 'marketingConsent', value: m.marketingConsent, version: null },
            },
          ]
        : [],
    }),
    answer: (a: NetworkAnswer): SourceAnswer => ({
      panel,
      sourceMemberId: a.memberId,
      sourceQuestionId: a.questionId,
      values: a.values,
      sourceUpdatedAt: a.updatedAt,
    }),
    question: (q: NetworkQuestion): StoredQuestion => ({
      panel,
      sourceQuestionId: q.questionId,
      label: q.label,
      type: q.type,
      parent: null,
      categories: [],
      isRequired: null,
      hasOthers: null,
      hasNone: null,
      maxSelections: null,
      sourceUpdatedAt: null,
      options: q.options.map((o) => ({
        panel,
        sourceQuestionId: q.questionId,
        value: o.value,
        label: o.label,
        parentValues: [],
        isExclusive: false,
      })),
    }),
    deletion: (d: NetworkDeletion): SourceDeletion => ({
      panel,
      sourceMemberId: d.memberId,
      kind: d.kind,
      at: d.at,
    }),
  };
}

/**
 * The encrypted inbox of networks on other software. Uploads and pushes write to it; the network's connector reads
 * it in id order, like a changes feed, so the normal sync does identity matching, consent and audit.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly database: Database,
    private readonly crypto: FieldCrypto,
  ) {}

  /** Stores one batch. Returns false when that batch id was already accepted for the panel (a retry). */
  async store(
    panel: PanelCode,
    batch: string,
    source: 'upload' | 'push',
    body: NetworkPush,
    by: string | null,
  ): Promise<{ stored: boolean; records: number }> {
    const conv = toSource(panel);
    const rows: (typeof networkRecords.$inferInsert)[] = [
      ...body.questions.map((q) => this.row(panel, batch, 'question', conv.question(q), null, q.questionId)),
      ...body.members.map((m) => this.row(panel, batch, 'member', conv.member(m), m.memberId, null)),
      ...body.answers.map((a) => this.row(panel, batch, 'answer', conv.answer(a), a.memberId, a.questionId)),
      ...body.deletions.map((d) => this.row(panel, batch, 'deletion', conv.deletion(d), d.memberId, null)),
    ];
    const kinds = [
      body.members.length && 'members',
      body.answers.length && 'answers',
      body.questions.length && 'questions',
      body.deletions.length && 'deletions',
    ].filter(Boolean);
    return this.database.db.transaction(async (tx) => {
      const [b] = await tx
        .insert(networkBatches)
        .values({ panel, batch, source, kind: kinds.join(',') || 'empty', records: rows.length, createdBy: by })
        .onConflictDoNothing()
        .returning();
      if (!b) return { stored: false, records: 0 };
      for (let i = 0; i < rows.length; i += 1000) await tx.insert(networkRecords).values(rows.slice(i, i + 1000));
      return { stored: true, records: rows.length };
    });
  }

  private row(
    panel: PanelCode,
    batch: string,
    kind: InboxKind,
    payload: unknown,
    member: string | null,
    question: string | null,
  ): typeof networkRecords.$inferInsert {
    return {
      panel,
      kind,
      batch,
      sourceMemberId: member,
      sourceQuestionId: question,
      payloadEnc: this.crypto.encrypt(JSON.stringify(payload))!,
    };
  }

  private open<T>(r: { payloadEnc: string }): T {
    return JSON.parse(this.crypto.decrypt(r.payloadEnc)!) as T;
  }

  /** Records of one kind after the id cursor, in order. */
  async page<T>(panel: PanelCode, kind: InboxKind, cursor: string | null, limit: number) {
    const after = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const rows = await this.database.db
      .select({ id: networkRecords.id, payloadEnc: networkRecords.payloadEnc })
      .from(networkRecords)
      .where(and(eq(networkRecords.panel, panel), eq(networkRecords.kind, kind), gt(networkRecords.id, after)))
      .orderBy(networkRecords.id)
      .limit(limit);
    const last = rows.at(-1)?.id ?? after;
    return { items: rows.map((r) => this.open<T>(r)), cursor: String(last), more: rows.length === limit };
  }

  /** The latest definition of each question. */
  async questions(panel: PanelCode): Promise<StoredQuestion[]> {
    const rows = await this.database.db.execute<{ payload_enc: string }>(
      sql`select distinct on (source_question_id) payload_enc from network_record
          where panel = ${panel} and kind = 'question' order by source_question_id, id desc`,
    );
    return rows.rows.map((r) => this.open<StoredQuestion>({ payloadEnc: r.payload_enc }));
  }

  /** The latest answer of each member to each question asked for. */
  async answers(panel: PanelCode, memberIds: string[], questionIds: string[]): Promise<SourceAnswer[]> {
    if (!memberIds.length || !questionIds.length) return [];
    const rows = await this.database.db
      .select({
        payloadEnc: networkRecords.payloadEnc,
        member: networkRecords.sourceMemberId,
        question: networkRecords.sourceQuestionId,
      })
      .from(networkRecords)
      .where(
        and(
          eq(networkRecords.panel, panel),
          eq(networkRecords.kind, 'answer'),
          inArray(networkRecords.sourceMemberId, memberIds),
          inArray(networkRecords.sourceQuestionId, questionIds),
        ),
      )
      .orderBy(desc(networkRecords.id));
    const seen = new Set<string>();
    const out: SourceAnswer[] = [];
    for (const r of rows) {
      const k = `${r.member}\u0000${r.question}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(this.open<SourceAnswer>(r));
    }
    return out;
  }

  async counts(panel: PanelCode) {
    const r = await this.database.db.execute<{ kind: string; n: number }>(
      sql`select kind, count(*)::int as n from network_record where panel = ${panel} group by kind`,
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.kind, x.n]));
    return { members: by.member ?? 0, answers: by.answer ?? 0, questions: by.question ?? 0, deletions: by.deletion ?? 0 };
  }

  async status(panel: PanelCode, name: string, liveApproved: boolean): Promise<NetworkStatus> {
    const [key] = await this.database.db.select().from(networkPushKeys).where(eq(networkPushKeys.panel, panel));
    const batches = await this.database.db
      .select()
      .from(networkBatches)
      .where(eq(networkBatches.panel, panel))
      .orderBy(desc(networkBatches.receivedAt))
      .limit(20);
    return {
      panel,
      name,
      liveApproved,
      pushKey: { set: !!key, hint: key?.hint ?? null, createdAt: key?.createdAt.toISOString() ?? null },
      inbox: await this.counts(panel),
      batches: batches.map((b) => ({
        batch: b.batch,
        source: b.source === 'push' ? 'push' : 'upload',
        kind: b.kind,
        records: b.records,
        receivedAt: b.receivedAt.toISOString(),
      })),
    };
  }

  /** Makes (or replaces) the panel's push key. The plain key is returned once and never shown again. */
  async newPushKey(panel: PanelCode, by: string): Promise<string> {
    const secret = `madp_push_${randomBytes(32).toString('base64url')}`;
    const values = { secretEnc: this.crypto.encrypt(secret)!, hint: `…${secret.slice(-4)}`, createdBy: by, createdAt: new Date() };
    await this.database.db
      .insert(networkPushKeys)
      .values({ panel, ...values })
      .onConflictDoUpdate({ target: networkPushKeys.panel, set: values });
    return secret;
  }

  async pushKey(panel: PanelCode): Promise<string | null> {
    const [key] = await this.database.db.select().from(networkPushKeys).where(eq(networkPushKeys.panel, panel));
    return key ? this.crypto.decrypt(key.secretEnc) : null;
  }

  async revokePushKey(panel: PanelCode) {
    await this.database.db.delete(networkPushKeys).where(eq(networkPushKeys.panel, panel));
  }
}
