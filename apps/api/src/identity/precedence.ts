import { sql, eq } from 'drizzle-orm';
import { PERSON_FIELDS, type PanelCode, type PersonField } from '@madp/contracts';
import type { Db } from '../db/database.js';
import { masterPersons } from '../db/schema.js';

export interface PrecedenceInput {
  id: string;
  panel: PanelCode;
  deleted: boolean;
  emailVerified: boolean;
  sourceUpdatedAt: Date | null;
  createdAt: Date;
  values: Partial<Record<PersonField, string | number | null>>;
}

export type FieldSources = Partial<Record<PersonField, { panel: PanelCode; sourceIdentityId: string }>>;

/** Orders identities by SOURCE_PRECEDENCE (packages/contracts/src/identity.ts). */
export function byPrecedence(a: PrecedenceInput, b: PrecedenceInput): number {
  if (a.emailVerified !== b.emailVerified) return a.emailVerified ? -1 : 1;
  const au = a.sourceUpdatedAt?.getTime() ?? -Infinity;
  const bu = b.sourceUpdatedAt?.getTime() ?? -Infinity;
  if (au !== bu) return bu - au;
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** Picks each person field from the highest-precedence identity that has a value, and records which one. */
export function resolveFields(identities: PrecedenceInput[]): {
  values: Record<PersonField, string | number | null>;
  sources: FieldSources;
} {
  const ranked = identities.filter((i) => !i.deleted).sort(byPrecedence);
  const values = Object.fromEntries(PERSON_FIELDS.map((f) => [f, null])) as Record<
    PersonField,
    string | number | null
  >;
  const sources: FieldSources = {};
  for (const f of PERSON_FIELDS) {
    const owner = ranked.find((i) => i.values[f] !== null && i.values[f] !== undefined && i.values[f] !== '');
    if (owner) {
      values[f] = owner.values[f]!;
      sources[f] = { panel: owner.panel, sourceIdentityId: owner.id };
    }
  }
  return { values, sources };
}

/** Recomputes a person's fields from its source identities. Call inside the transaction that changed them. */
export async function recomputePerson(tx: Db, personId: string): Promise<{ identities: number }> {
  const rows = await tx.execute<{
    id: string;
    panel: PanelCode;
    deleted: boolean;
    verified: boolean;
    source_updated_at: string | null;
    created_at: string;
    country: string | null;
    state: string | null;
    city: string | null;
    gender: string | null;
    birth_year: number | null;
  }>(sql`
    select si.id, si.panel, coalesce(pm.status = 'deleted', false) as deleted,
      si.email_verification = 'verified' as verified, si.source_updated_at, si.created_at,
      si.country, si.state, si.city, si.gender, si.birth_year
    from source_identity si left join panel_membership pm on pm.source_identity_id = si.id
    where si.master_person_id = ${personId}`);
  const { values, sources } = resolveFields(
    rows.rows.map((r) => ({
      id: r.id,
      panel: r.panel,
      deleted: r.deleted,
      emailVerified: r.verified,
      sourceUpdatedAt: r.source_updated_at ? new Date(r.source_updated_at) : null,
      createdAt: new Date(r.created_at),
      values: { country: r.country, state: r.state, city: r.city, gender: r.gender, birthYear: r.birth_year },
    })),
  );
  await tx
    .update(masterPersons)
    .set({
      country: values.country as string | null,
      state: values.state as string | null,
      city: values.city as string | null,
      gender: values.gender as string | null,
      birthYear: values.birthYear as number | null,
      fieldSources: sources,
      status: rows.rows.length ? 'active' : 'merged',
      updatedAt: new Date(),
    })
    .where(eq(masterPersons.id, personId));
  return { identities: rows.rows.length };
}
