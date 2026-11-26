import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { MemberTypeRule, type MemberTypeValue, type PanelCode } from '@madp/contracts';
import { Database } from '../db/database.js';
import { memberTypeRules } from '../db/schema.js';

/**
 * Starting "Type" columns, from the real question banks (2026-11-25 exports). T2O and MFR share the consumer and
 * business keys; MHO has its own HCP, caregiver and patient questions. A Super Admin changes them on the Members
 * screen. Panels added later start with none.
 */
const CONSUMER_PANEL: MemberTypeRule[] = [
  { category: 'b2c', label: 'Work', questions: ['empstat'], sensitive: false },
  { category: 'b2b', label: 'Designation', questions: ['jobrole'], sensitive: false },
];
export const DEFAULT_TYPE_RULES: Partial<Record<PanelCode, MemberTypeRule[]>> = {
  t2o: CONSUMER_PANEL,
  mfr: CONSUMER_PANEL,
  mho: [
    { category: 'healthcare professional', label: 'HCP type', questions: ['doc-expertise'], sensitive: false },
    { category: 'healthcare professional', label: 'Specialty', questions: ['specialty-area'], sensitive: false },
    {
      category: 'care giver',
      label: 'Caregiver type',
      questions: ['caregiving-situation'],
      sensitive: false,
      aliases: {
        'I provide unpaid care to a family member or someone I know': 'Home caregiver',
        'I provide paid/professional care as part of my work': 'Professional caregiver',
        'I provide both unpaid and paid/professional care': 'Home and professional caregiver',
      },
    },
    { category: 'patient', label: 'Condition', questions: ['primary-health-condition-currently'], sensitive: true },
  ],
};

export type TypedRow = { category?: string; types?: Record<string, string[]>; typeValues?: MemberTypeValue[] };

@Injectable()
export class MemberTypes {
  constructor(private readonly database: Database) {}

  /** The brand's rules: saved ones, else the defaults. `saved` tells the screen which it is. */
  async rules(panel: PanelCode): Promise<{ rules: MemberTypeRule[]; saved: boolean }> {
    const [row] = await this.database.db.select().from(memberTypeRules).where(eq(memberTypeRules.panel, panel));
    if (!row) return { rules: DEFAULT_TYPE_RULES[panel] ?? [], saved: false };
    // Validated on save; parsed again so a later stricter schema never breaks the Members table.
    const parsed = MemberTypeRule.array().safeParse(row.rules);
    return { rules: parsed.success ? parsed.data : [], saved: true };
  }

  async save(panel: PanelCode, rules: MemberTypeRule[], actor: string) {
    await this.database.db
      .insert(memberTypeRules)
      .values({ panel, rules, updatedBy: actor })
      .onConflictDoUpdate({ target: memberTypeRules.panel, set: { rules, updatedBy: actor, updatedAt: new Date() } });
  }

  /** Swaps the panel's raw `types` for what the Type column shows, by the row's category. */
  static annotate<T extends TypedRow>(rows: T[], rules: MemberTypeRule[]): T[] {
    for (const r of rows) {
      const cat = String(r.category ?? '').toLowerCase();
      r.typeValues = rules
        .filter((x) => x.category === cat)
        .map((x) => ({
          label: x.label,
          values: [...new Set(x.questions.flatMap((k) => r.types?.[k] ?? []).map((v) => x.aliases?.[v] ?? v))],
        }))
        .filter((v) => v.values.length > 0);
      delete r.types;
    }
    return rows;
  }
}
