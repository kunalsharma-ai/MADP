import { ForbiddenException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  PANEL_CODES,
  QUALITY_CHECKS,
  type DataMode,
  type EvidenceCreate,
  type EvidenceDecision,
  type EvidenceQuery,
  type PanelCode,
  type QualityCheck,
} from '@madp/contracts';
import { Database } from '../db/database.js';
import { panelMemberships, verificationEvidence } from '../db/schema.js';
import { AuditService, type AuditEntry } from '../audit/audit.service.js';

/** T2O and MFR accept ages 13 to 120 (panel audits). */
const MIN_AGE = 13;
const MAX_AGE = 120;
/** Every T2O/MFR member starts at 100; the maximum is 200 (panel audits). */
const DEFAULT_QUALITY = 100;

type Actor = Pick<AuditEntry, 'actorId' | 'actorType' | 'actorRole' | 'ip' | 'userAgent' | 'requestId'> & {
  actorId: string | null;
};

/** One SQL condition per check, over `s` (source_identity) of active memberships `m` in one panel. */
function checkSql(check: QualityCheck, mode: DataMode, panel: PanelCode): SQL {
  switch (check) {
    case 'missing_country':
      return sql`coalesce(s.country, '') = ''`;
    case 'missing_birth_year':
      return sql`s.birth_year is null`;
    case 'implausible_age':
      return sql`s.birth_year is not null and (extract(year from now())::int - s.birth_year < ${MIN_AGE} or extract(year from now())::int - s.birth_year > ${MAX_AGE})`;
    case 'missing_timezone':
      return sql`coalesce(s.timezone, '') = ''`;
    case 'unknown_timezone':
      return sql`coalesce(s.timezone, '') <> '' and not exists (select 1 from pg_timezone_names tz where tz.name = s.timezone)`;
    case 'no_email':
      return sql`s.email_hash is null`;
    case 'email_rejected':
      return sql`s.email_verification = 'rejected'`;
    case 'shared_email_in_panel':
      return sql`s.email_hash in (
        select s2.email_hash from panel_membership m2 join source_identity s2 on s2.id = m2.source_identity_id
        where m2.data_mode = ${mode} and m2.panel = ${panel} and m2.status = 'active' and s2.email_hash is not null
        group by s2.email_hash having count(*) > 1)`;
    case 'quality_below_default':
      return sql`s.quality_score < ${DEFAULT_QUALITY}`;
    case 'no_quality_score':
      return sql`s.quality_score is null`;
  }
}

const CHECK_LABELS: Record<QualityCheck, { label: string; why: string }> = {
  missing_country: { label: 'No country', why: 'Cannot be counted by geography or matched to country quotas.' },
  missing_birth_year: { label: 'No birth year', why: 'Age filters and age rules cannot be applied.' },
  implausible_age: { label: `Age outside ${MIN_AGE} to ${MAX_AGE}`, why: 'The panels accept ages 13 to 120 only.' },
  missing_timezone: { label: 'No time zone', why: 'Quiet hours cannot be applied to messages.' },
  unknown_timezone: { label: 'Unknown time zone', why: 'Not an IANA time zone name; quiet hours fall back to UTC.' },
  no_email: { label: 'No e-mail on record', why: 'Cannot be reached by e-mail or matched across panels by e-mail.' },
  email_rejected: { label: 'E-mail rejected by the panel', why: 'The panel marked the address as failed verification.' },
  shared_email_in_panel: { label: 'E-mail shared by two or more members', why: 'Possible duplicate accounts in the same panel.' },
  quality_below_default: { label: `Quality score below ${DEFAULT_QUALITY}`, why: 'Members start at 100; a lower score means the panel took points off for quality.' },
  no_quality_score: { label: 'No quality score', why: 'The panel did not report one.' },
};

/**
 * Verification and data quality center (screen 8). Everything is per panel and never added across panels.
 * Verification states and quality scores are what each panel reported; MADP's own checks run on its copy of the
 * member record; independent evidence is recorded by one admin and decided by another.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async summary(mode: DataMode, panels: PanelCode[]) {
    const out = [];
    for (const panel of panels) out.push(await this.panelSummary(mode, panel));
    return {
      dataMode: mode,
      asOf: new Date().toISOString(),
      checks: QUALITY_CHECKS.map((key) => ({ key, ...CHECK_LABELS[key] })),
      panels: out,
    };
  }

  private async panelSummary(mode: DataMode, panel: PanelCode) {
    const db = this.database.db;
    const base = sql`from panel_membership m join source_identity s on s.id = m.source_identity_id
      where m.data_mode = ${mode} and m.panel = ${panel} and m.status = 'active'`;
    const [v] = (
      await db.execute<Record<string, string>>(sql`select count(*) as members,
        count(*) filter (where s.email_verification = 'verified') as email_verified,
        count(*) filter (where s.email_verification = 'unverified') as email_unverified,
        count(*) filter (where s.email_verification = 'rejected') as email_rejected,
        count(*) filter (where s.phone_verification = 'verified') as phone_verified,
        count(*) filter (where s.phone_verification = 'unverified') as phone_unverified,
        count(*) filter (where s.phone_verification = 'rejected') as phone_rejected,
        count(*) filter (where s.quality_score is null) as q_none,
        count(*) filter (where s.quality_score < 50) as q_0,
        count(*) filter (where s.quality_score >= 50 and s.quality_score < 100) as q_50,
        count(*) filter (where s.quality_score >= 100 and s.quality_score < 150) as q_100,
        count(*) filter (where s.quality_score >= 150) as q_150
        ${base}`)
    ).rows;
    const n = (k: string) => Number(v?.[k] ?? 0);
    const checkCols = sql.join(
      QUALITY_CHECKS.map((c) => sql`count(*) filter (where ${checkSql(c, mode, panel)}) as ${sql.identifier(c)}`),
      sql`, `,
    );
    const [c] = (await db.execute<Record<string, string>>(sql`select ${checkCols} ${base}`)).rows;
    const evidence = (
      await db.execute<{ claim: string; status: string; expired: boolean; n: string }>(sql`
        select e.claim, e.status, (e.status = 'verified' and e.expires_on < current_date) as expired, count(*) as n
        from verification_evidence e join panel_membership m on m.id = e.panel_membership_id
        where e.data_mode = ${mode} and e.panel = ${panel} and m.status = 'active' group by 1, 2, 3`)
    ).rows;
    const [idr] = (
      await db.execute<{ n: string }>(sql`select count(*) as n from identity_match_candidate c
        join source_identity s on s.id = c.source_identity_id
        where c.data_mode = ${mode} and s.panel = ${panel} and c.status = 'pending'`)
    ).rows;
    const byClaim: Record<string, { pending: number; verified: number; expired: number; rejected: number; revoked: number }> = {};
    for (const r of evidence) {
      const b = (byClaim[r.claim] ??= { pending: 0, verified: 0, expired: 0, rejected: 0, revoked: 0 });
      const key = r.expired ? 'expired' : (r.status as keyof typeof b);
      b[key] += Number(r.n);
    }
    return {
      panel,
      members: n('members'),
      sourceReported: {
        email: { verified: n('email_verified'), unverified: n('email_unverified'), rejected: n('email_rejected') },
        phone: { verified: n('phone_verified'), unverified: n('phone_unverified'), rejected: n('phone_rejected') },
        qualityScore: {
          none: n('q_none'),
          below50: n('q_0'),
          from50to99: n('q_50'),
          from100to149: n('q_100'),
          from150: n('q_150'),
        },
      },
      checks: Object.fromEntries(QUALITY_CHECKS.map((k) => [k, Number(c?.[k] ?? 0)])),
      evidence: byClaim,
      identityReviewOpen: Number(idr?.n ?? 0),
    };
  }

  /** Who fails one check: person ids and masked panel ids only, no personal data. */
  async drill(mode: DataMode, panel: PanelCode, check: QualityCheck, limit: number) {
    const rows = (
      await this.database.db.execute<{
        person_id: string;
        source_member_id: string;
        quality_score: number | null;
        email_verification: string;
        country: string | null;
        timezone: string | null;
      }>(sql`select m.master_person_id as person_id, s.source_member_id, s.quality_score, s.email_verification::text,
          s.country, s.timezone
        from panel_membership m join source_identity s on s.id = m.source_identity_id
        where m.data_mode = ${mode} and m.panel = ${panel} and m.status = 'active' and (${checkSql(check, mode, panel)})
        order by s.quality_score nulls first, m.master_person_id limit ${limit}`)
    ).rows;
    return {
      panel,
      check,
      ...CHECK_LABELS[check],
      items: rows.map((r) => ({
        personId: r.person_id,
        sourceMember: `${r.source_member_id.slice(0, 4)}…`,
        qualityScore: r.quality_score,
        emailVerification: r.email_verification,
        country: r.country,
        timezone: check === 'unknown_timezone' || check === 'missing_timezone' ? r.timezone : undefined,
      })),
    };
  }

  async list(mode: DataMode, panels: PanelCode[], q: EvidenceQuery) {
    const db = this.database.db;
    const where = [eq(verificationEvidence.dataMode, mode), inArray(verificationEvidence.panel, panels)];
    if (q.status) where.push(eq(verificationEvidence.status, q.status));
    if (q.personId) where.push(eq(panelMemberships.masterPersonId, q.personId));
    const rows = await db
      .select({
        id: verificationEvidence.id,
        personId: panelMemberships.masterPersonId,
        panel: verificationEvidence.panel,
        claim: verificationEvidence.claim,
        method: verificationEvidence.method,
        reference: verificationEvidence.reference,
        status: verificationEvidence.status,
        expiresOn: verificationEvidence.expiresOn,
        recordedBy: verificationEvidence.recordedBy,
        decidedBy: verificationEvidence.decidedBy,
        decidedAt: verificationEvidence.decidedAt,
        decisionNote: verificationEvidence.decisionNote,
        createdAt: verificationEvidence.createdAt,
        expired: sql<boolean>`(${verificationEvidence.status} = 'verified' and ${verificationEvidence.expiresOn} < current_date)`,
      })
      .from(verificationEvidence)
      .innerJoin(panelMemberships, eq(panelMemberships.id, verificationEvidence.panelMembershipId))
      .where(and(...where))
      .orderBy(sql`(${verificationEvidence.status} = 'pending') desc`, desc(verificationEvidence.createdAt))
      .limit(q.limit);
    return { items: rows };
  }

  async create(mode: DataMode, b: EvidenceCreate, actor: Actor) {
    const db = this.database.db;
    const [m] = await db
      .select({ id: panelMemberships.id })
      .from(panelMemberships)
      .where(
        and(
          eq(panelMemberships.dataMode, mode),
          eq(panelMemberships.masterPersonId, b.personId),
          eq(panelMemberships.panel, b.panel),
          ne(panelMemberships.status, 'deleted'),
        ),
      )
      .limit(1);
    if (!m) throw new NotFoundException(`This person is not a member of ${b.panel.toUpperCase()}`);
    const [row] = await db
      .insert(verificationEvidence)
      .values({
        dataMode: mode,
        panelMembershipId: m.id,
        panel: b.panel,
        claim: b.claim,
        method: b.method,
        reference: b.reference,
        expiresOn: b.expiresOn ?? null,
        recordedBy: actor.actorId!,
      })
      .returning();
    await this.audit.record({
      ...actor,
      panel: b.panel,
      action: 'verification.evidence_recorded',
      targetType: 'master_person',
      targetId: b.personId,
      metadata: { evidenceId: row!.id, claim: b.claim, method: b.method },
    });
    return { ...row!, personId: b.personId };
  }

  private async load(id: string, panels: PanelCode[]) {
    const [row] = await this.database.db
      .select({ e: verificationEvidence, personId: panelMemberships.masterPersonId })
      .from(verificationEvidence)
      .innerJoin(panelMemberships, eq(panelMemberships.id, verificationEvidence.panelMembershipId))
      .where(eq(verificationEvidence.id, id));
    if (!row || !panels.includes(row.e.panel)) throw new NotFoundException('No such evidence');
    return row;
  }

  /** Four eyes: whoever recorded the evidence cannot decide it. */
  async decide(id: string, panels: PanelCode[], b: EvidenceDecision, actor: Actor) {
    const { e, personId } = await this.load(id, panels);
    if (e.status !== 'pending') throw new ConflictException(`Already ${e.status}`);
    if (e.recordedBy === actor.actorId)
      throw new ForbiddenException('The admin who recorded this evidence cannot decide it');
    return this.transition(e, personId, b.decision, b.note, actor, 'pending');
  }

  async revoke(id: string, panels: PanelCode[], note: string, actor: Actor) {
    const { e, personId } = await this.load(id, panels);
    if (e.status !== 'verified') throw new ConflictException('Only verified evidence can be revoked');
    return this.transition(e, personId, 'revoked', note, actor, 'verified');
  }

  private async transition(
    e: typeof verificationEvidence.$inferSelect,
    personId: string,
    status: 'verified' | 'rejected' | 'revoked',
    note: string,
    actor: Actor,
    from: string,
  ) {
    const [row] = await this.database.db
      .update(verificationEvidence)
      .set({ status, decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note, updatedAt: new Date() })
      .where(and(eq(verificationEvidence.id, e.id), eq(verificationEvidence.status, from)))
      .returning();
    if (!row) throw new ConflictException('Changed by someone else; reload');
    await this.audit.record({
      ...actor,
      panel: e.panel,
      action: `verification.evidence_${status}`,
      targetType: 'master_person',
      targetId: personId,
      before: { status: from },
      after: { status },
      metadata: { evidenceId: e.id, claim: e.claim },
    });
    return { ...row, personId };
  }

  static panelsFor(brand: string, panel?: PanelCode): PanelCode[] {
    if (brand !== 'all') {
      if (panel && panel !== brand) throw new ForbiddenException('That panel is outside the selected brand');
      return [brand as PanelCode];
    }
    return panel ? [panel] : [...PANEL_CODES];
  }
}
