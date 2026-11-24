import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AudienceCategory, HealthAccessPurpose, PanelCode } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { Mongo } from '../mongo/mongo.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { AudienceService } from '../audience/audience.service.js';
import { AuditService } from '../audit/audit.service.js';

const ListQuery = z.object({
  panel: PanelCode.optional(),
  category: AudienceCategory.optional(),
  country: z.string().length(2).optional(),
  /** Exact source member id / respondent ref, or an exact e-mail (matched by keyed hash, never by LIKE). */
  search: z.string().max(200).optional(),
  /** Keyset cursor: last person id of the previous page. */
  after: z.string().uuid().optional(),
  /** Panel membership status: active, inactive (deactivated on the panel) or deleted (removed by the panel). */
  membership: z.enum(['active', 'inactive', 'deleted']).optional(),
  /** Teens only (members flagged as minors). */
  minor: z.enum(['true']).optional(),
  /** Guardian consent status (teens): granted, unknown (not decided yet), denied or withdrawn. */
  guardian: z.enum(['granted', 'unknown', 'denied', 'withdrawn']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('panellists')
export class PanellistsController {
  constructor(
    private readonly database: Database,
    private readonly mongo: Mongo,
    private readonly crypto: FieldCrypto,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('panellists.read')
  @Get()
  async list(@Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    const mode = this.audience.defaultMode();
    const conds = [sql`mp.data_mode = ${mode}`, sql`mp.status <> 'merged'`];
    if (q.after) conds.push(sql`mp.id > ${q.after}`);
    if (q.country) conds.push(sql`mp.country = ${q.country.toLowerCase()}`);
    if (q.panel)
      conds.push(
        sql`exists (select 1 from panel_membership x where x.master_person_id = mp.id and x.panel = ${q.panel})`,
      );
    const panelCond = q.panel ? sql` and x.panel = ${q.panel}` : sql``;
    if (q.membership)
      conds.push(
        sql`exists (select 1 from panel_membership x where x.master_person_id = mp.id and x.status = ${q.membership}${panelCond})`,
      );
    if (q.minor)
      conds.push(
        sql`exists (select 1 from category_membership x where x.master_person_id = mp.id and x.is_minor${panelCond})`,
      );
    if (q.guardian)
      conds.push(
        sql`exists (select 1 from consent_record x where x.master_person_id = mp.id and x.purpose = 'guardian_consent' and x.status = ${q.guardian}${panelCond})`,
      );
    if (q.category)
      conds.push(
        sql`exists (select 1 from category_membership x where x.master_person_id = mp.id and x.category = ${q.category})`,
      );
    if (q.search) {
      const h = this.crypto.emailHash(q.search);
      conds.push(
        sql`exists (select 1 from source_identity x where x.master_person_id = mp.id and (x.source_member_id = ${q.search} or x.source_respondent_ref = ${q.search} ${h ? sql`or x.email_hash = ${h}` : sql``}))`,
      );
    }
    const rows = await this.database.db.execute<{
      id: string;
      country: string | null;
      state: string | null;
      city: string | null;
      birth_year: number | null;
      gender: string | null;
      created_at: Date;
      panels: string[];
      categories: string[];
      email_masked: string | null;
      verified: boolean;
      memberships: { panel: string; status: string }[] | null;
      minor: boolean;
      guardian: string | null;
    }>(sql`
      select mp.id, mp.country, mp.state, mp.city, mp.birth_year, mp.gender, mp.created_at,
        (select array_agg(distinct pm.panel::text) from panel_membership pm where pm.master_person_id = mp.id) as panels,
        (select array_agg(distinct cm.category::text) from category_membership cm where cm.master_person_id = mp.id) as categories,
        (select si.email_masked from source_identity si where si.master_person_id = mp.id order by si.created_at limit 1) as email_masked,
        exists (select 1 from source_identity si where si.master_person_id = mp.id and si.email_verification = 'verified') as verified,
        (select json_agg(json_build_object('panel', pm.panel, 'status', pm.status) order by pm.panel) from panel_membership pm where pm.master_person_id = mp.id) as memberships,
        exists (select 1 from category_membership cm where cm.master_person_id = mp.id and cm.is_minor) as minor,
        (select cr.status::text from consent_record cr where cr.master_person_id = mp.id and cr.purpose = 'guardian_consent' order by cr.created_at desc limit 1) as guardian
      from master_person mp
      where ${sql.join(conds, sql` and `)}
      order by mp.id
      limit ${q.limit + 1}`);
    const items = rows.rows.slice(0, q.limit);
    return {
      dataMode: mode,
      items: items.map((r) => ({
        id: r.id,
        country: r.country,
        state: r.state,
        city: r.city,
        birthYear: r.birth_year,
        gender: r.gender,
        panels: r.panels ?? [],
        categories: r.categories ?? [],
        emailMasked: r.email_masked,
        emailVerified: r.verified,
        memberships: r.memberships ?? [],
        minor: r.minor,
        guardianConsent: r.guardian,
        createdAt: r.created_at,
      })),
      nextCursor: rows.rows.length > q.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * 360-degree profile. PII is decrypted only for `panellists.pii.read`. Special-category (health) answers need
   * `health.sensitive.read` and a stated `purpose`; a minor's MHO health answers also need the guardian's consent
   * to be granted. Every view is audited with its purpose.
   */
  @RequirePermissions('panellists.read')
  @Get(':id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
    @Query('purpose', new ZodPipe(HealthAccessPurpose.optional())) purpose?: HealthAccessPurpose,
  ) {
    const db = this.database.db;
    const person = await db.query.masterPersons.findFirst({ where: (m, { eq }) => eq(m.id, id) });
    if (!person) throw new NotFoundException();
    const canPii = p.permissions.includes('panellists.pii.read');
    const mayHealth = p.permissions.includes('health.sensitive.read');
    const canHealth = mayHealth && Boolean(purpose);
    const identities = await db.query.sourceIdentities.findMany({
      where: (s, { eq }) => eq(s.masterPersonId, id),
    });
    const memberships = await db.query.panelMemberships.findMany({
      where: (m, { eq }) => eq(m.masterPersonId, id),
    });
    const categories = await db.query.categoryMemberships.findMany({
      where: (c, { eq }) => eq(c.masterPersonId, id),
    });
    const candidates = await db.query.identityMatchCandidates.findMany({
      where: (c, { eq, or }) =>
        or(eq(c.candidatePersonId, id), ...identities.map((i) => eq(c.sourceIdentityId, i.id))),
    });
    const consents = await db.query.consentRecords.findMany({
      where: (c, { eq }) => eq(c.masterPersonId, id),
      orderBy: (c, { asc }) => [asc(c.panel), asc(c.purpose)],
    });
    const answers = await this.mongo.profileAnswers
      .find({ personId: id }, { projection: { _id: 0 } })
      .sort({ panel: 1, sourceQuestionId: 1 })
      .toArray();
    const labels = new Map(
      (
        await this.mongo.questionVersions
          .find(
            { dataMode: person.dataMode, sourceQuestionId: { $in: answers.map((a) => a.sourceQuestionId) } },
            { projection: { panel: 1, sourceQuestionId: 1, version: 1, label: 1 } },
          )
          .toArray()
      ).map((d) => [`${d.panel}|${d.sourceQuestionId}|${d.version}`, d.label]),
    );
    // A minor's health answers from a panel stay hidden until that panel's guardian consent is granted.
    const minorPanels = new Set(categories.filter((c) => c.isMinor).map((c) => c.panel));
    const guardianOk = new Set(
      consents.filter((c) => c.purpose === 'guardian_consent' && c.status === 'granted').map((c) => c.panel),
    );
    const minorLocked = (a: { panel: PanelCode; sensitivity: string }) =>
      a.sensitivity === 'special_category' && minorPanels.has(a.panel) && !guardianOk.has(a.panel);
    const showAnswer = (a: { panel: PanelCode; sensitivity: string }) =>
      a.sensitivity !== 'special_category' || (canHealth && !minorLocked(a));
    const hiddenSensitive = answers.filter((a) => !showAnswer(a)).length;
    const hiddenMinor = canHealth ? answers.filter(minorLocked).length : 0;
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'panellist.viewed',
      targetType: 'master_person',
      targetId: id,
      metadata: { pii: canPii, health: canHealth, purpose: purpose ?? null, hiddenSensitive },
      ip: req.ip ?? null,
    });
    return {
      dataMode: person.dataMode,
      person: {
        id: person.id,
        country: person.country,
        state: person.state,
        city: person.city,
        birthYear: person.birthYear,
        gender: person.gender,
        status: person.status,
        fieldSources: person.fieldSources ?? {},
        createdAt: person.createdAt,
      },
      access: {
        pii: canPii,
        healthSensitive: canHealth,
        /** The viewer may see health answers but has to say why first. */
        healthPurposeRequired: mayHealth && !purpose && answers.some((a) => a.sensitivity === 'special_category'),
        purpose: purpose ?? null,
      },
      identities: identities.map((i) => ({
        id: i.id,
        panel: i.panel,
        sourceMemberId: canPii ? i.sourceMemberId : `${i.sourceMemberId.slice(0, 4)}…`,
        sourceRespondentRef: i.sourceRespondentRef,
        sourceCategory: i.sourceCategory,
        email: canPii ? this.crypto.decrypt(i.emailEnc) : i.emailMasked,
        name: canPii
          ? [this.crypto.decrypt(i.firstNameEnc), this.crypto.decrypt(i.lastNameEnc)]
              .filter(Boolean)
              .join(' ')
          : null,
        dateOfBirth: canPii ? this.crypto.decrypt(i.dateOfBirthEnc) : null,
        emailVerification: i.emailVerification,
        phoneVerification: i.phoneVerification,
        qualityScore: i.qualityScore,
        sourceActive: i.sourceActive,
        sourceCreatedAt: i.sourceCreatedAt,
        sourceUpdatedAt: i.sourceUpdatedAt,
      })),
      memberships: memberships.map((m) => ({ panel: m.panel, status: m.status, joinedAt: m.joinedAt })),
      categories: categories.map((c) => ({
        panel: c.panel,
        category: c.category,
        basis: c.basis,
        isMinor: c.isMinor,
      })),
      consents: consents.map((c) => ({
        panel: c.panel,
        purpose: c.purpose,
        status: c.status,
        channel: c.channel,
        version: (c.evidence as { version?: string | null } | null)?.version ?? null,
        capturedAt: c.capturedAt,
      })),
      identityCandidates: candidates.map((c) => ({
        id: c.id,
        rule: c.rule,
        status: c.status,
        createdAt: c.createdAt,
      })),
      answers: answers
        .filter(showAnswer)
        .map((a) => ({
          panel: a.panel,
          sourceQuestionId: a.sourceQuestionId,
          label: labels.get(`${a.panel}|${a.sourceQuestionId}|${a.questionVersion}`) ?? null,
          questionVersion: a.questionVersion,
          values: a.values,
          sensitivity: a.sensitivity,
          sourceUpdatedAt: a.sourceUpdatedAt,
          ingestedAt: a.ingestedAt,
        })),
      hiddenSensitiveAnswers: hiddenSensitive,
      /** Of those, hidden because the member is a minor without granted guardian consent on that panel. */
      hiddenMinorAnswers: hiddenMinor,
    };
  }
}
