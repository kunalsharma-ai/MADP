import { sql } from 'drizzle-orm';
import type { SuppressionReason } from '@madp/contracts';

/** What the contact gate needs to know about one member of one panel. */
export interface GateRow {
  status: string;
  minor: boolean;
  opted_out: boolean;
  consent: string | null;
  has_email: boolean;
  email_rejected: boolean;
  bounced: boolean;
  week: string | number;
  month: string | number;
}

/**
 * The first rule that stops a message, in a fixed order, or null. Service messages skip the minor, opt-out and
 * frequency rules; everything else needs the basis's consent, a usable address, and room under the caps.
 */
export function gate(
  r: GateRow,
  basis: 'marketing' | 'onboarding' | 'service',
  consent: string | null,
  policy: { maxPerWeek: number; maxPerMonth: number },
  alreadySent = false,
): SuppressionReason | null {
  if (r.status !== 'active') return 'membership_not_active';
  if (r.minor && basis !== 'service') return 'minor_excluded';
  if (r.opted_out && basis !== 'service') return 'opted_out';
  if (consent && r.consent !== 'granted') return 'no_consent';
  if (!r.has_email || r.email_rejected) return 'no_email';
  if (r.bounced) return 'bounced_or_complained';
  if (alreadySent) return 'already_sent';
  if (basis !== 'service' && Number(r.week) >= policy.maxPerWeek) return 'frequency_cap_week';
  if (basis !== 'service' && Number(r.month) >= policy.maxPerMonth) return 'frequency_cap_month';
  return null;
}

/**
 * Real delivery states that count towards frequency caps. Opens and clicks are reactions to a message already
 * counted, not new contacts. Dry-run rows never count.
 */
export const CONTACT_STATES = ['queued', 'sent', 'delivered'];
const contactStates = `{${CONTACT_STATES.join(',')}}`;

/**
 * The GateRow columns for `panel_membership pm` joined to `source_identity si`, as of `now`. `consent` is the
 * purpose the message basis needs (null for service messages).
 */
export function contactColumns(consent: string | null, now: Date) {
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const month = new Date(now.getTime() - 30 * 86_400_000);
  return sql`pm.status, si.email_enc is not null as has_email,
    si.email_verification = 'rejected' as email_rejected,
    exists (select 1 from category_membership cm where cm.master_person_id = pm.master_person_id and cm.panel = pm.panel and cm.is_minor) as minor,
    (select cr.status::text from consent_record cr where cr.master_person_id = pm.master_person_id and cr.panel = pm.panel
      and cr.purpose = ${consent ?? ''} limit 1) as consent,
    (select count(*) from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
      and not e.dry_run and e.state = any(${contactStates}::text[]) and e.occurred_at > ${week} and e.occurred_at <= ${now}) as week,
    (select count(*) from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
      and not e.dry_run and e.state = any(${contactStates}::text[]) and e.occurred_at > ${month} and e.occurred_at <= ${now}) as month,
    exists (select 1 from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
      and not e.dry_run and e.state = 'opted_out' and e.occurred_at <= ${now}) as opted_out,
    exists (select 1 from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
      and not e.dry_run and e.state in ('bounced', 'complained') and e.occurred_at <= ${now}) as bounced`;
}

/** Members of one panel in one data mode, narrowed to the audience's categories and countries. */
export function audienceFilter(
  mode: string,
  panel: string,
  audience: { categories?: string[]; countries?: string[] },
) {
  const conds = [sql`pm.data_mode = ${mode}`, sql`pm.panel = ${panel}`];
  if (audience.categories?.length)
    conds.push(sql`exists (select 1 from category_membership cm where cm.master_person_id = pm.master_person_id
      and cm.panel = pm.panel and cm.category::text = any(${`{${audience.categories.join(',')}}`}::text[]))`);
  if (audience.countries?.length) conds.push(sql`mp.country = any(${`{${audience.countries.join(',')}}`}::text[])`);
  return sql.join(conds, sql` and `);
}
