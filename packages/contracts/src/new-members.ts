import { z } from 'zod';
import { PanelCode } from './panels.js';

/** Marks a panel's new sign-ups as seen for the signed-in admin. Without `panel`, every panel they may see. */
export const NewMembersSeen = z.object({ panel: PanelCode.optional() }).strict();
export type NewMembersSeen = z.infer<typeof NewMembersSeen>;

/** New sign-ups per panel and segment since the admin last marked them seen. Counts only, no personal data. */
export interface NewMembersPanel {
  panel: string;
  /** Members MADP learned about after this moment count as new (the admin's last "seen", else 24 hours ago). */
  since: string;
  total: number;
  /** New members per audience segment key. A member in two segments counts in both. */
  segments: { key: string; count: number }[];
  /** True when the admin has no teen access on this panel: teens are left out of every number. */
  teensHidden: boolean;
}

export interface NewMembersRecent {
  panel: string;
  segments: string[];
  country: string | null;
  /** When the member signed up on the panel. */
  signedUpAt: string | null;
  /** When MADP's sync brought the member in. */
  arrivedAt: string;
}

export interface NewMembersSummary {
  dataMode: 'demo' | 'live';
  checkedAt: string;
  total: number;
  panels: NewMembersPanel[];
  recent: NewMembersRecent[];
}

/**
 * A saved Members-table view: filters and sort under a name, per brand. Only list filters are kept, never a search for
 * one person (e-mail, phone, name or id), so a view holds no personal data.
 */
export const MemberViewParams = z
  .object({
    status: z.enum(['active', 'suspended', 'banned', 'archived']).optional(),
    category: z.string().trim().max(40).optional(),
    marketing: z.enum(['granted', 'withdrawn', 'unset']).optional(),
    country: z.string().trim().regex(/^[a-zA-Z]{2}$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Rolling sign-up window: the last N days, worked out when the view is opened ("new this week"). */
    lastDays: z.coerce.number().int().min(1).max(3650).optional(),
    qualityMin: z.coerce.number().int().min(0).max(200).optional(),
    qualityMax: z.coerce.number().int().min(0).max(200).optional(),
    inactiveSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dueBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    bornFrom: z.coerce.number().int().min(1900).max(2100).optional(),
    bornTo: z.coerce.number().int().min(1900).max(2100).optional(),
    gender: z.enum(['Male', 'Female', 'Other']).optional(),
    ageMin: z.coerce.number().int().min(0).max(120).optional(),
    ageMax: z.coerce.number().int().min(0).max(120).optional(),
    tag: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9 _-]{0,29}$/).optional(),
    sort: z.string().trim().max(20).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();
export type MemberViewParams = z.infer<typeof MemberViewParams>;

export const MemberViewCreate = z
  .object({
    name: z.string().trim().min(2).max(60),
    params: MemberViewParams,
    /** Shared views show for every admin of the brand; only the author can delete them. */
    shared: z.boolean().default(false),
  })
  .strict();
export type MemberViewCreate = z.infer<typeof MemberViewCreate>;

export interface MemberView {
  id: string;
  panel: string;
  name: string;
  params: MemberViewParams;
  shared: boolean;
  mine: boolean;
  createdBy: string;
  createdAt: string;
}

/** One line of the live activity feed. Never a name, e-mail or ticket text. */
export type ActivityItem = {
  id: string;
  panel: string;
  at: string;
} & (
  | { kind: 'signup'; segments: string[]; country: string | null }
  | { kind: 'survey_complete'; survey: string | null; points: number; country: string | null }
  | { kind: 'redemption'; points: number }
  | { kind: 'ticket'; ticketNo: string; category: string | null; priority: string; status: string }
);

export interface ActivityFeed {
  dataMode: 'demo' | 'live';
  checkedAt: string;
  items: ActivityItem[];
  /** Panels whose admin API did not answer: their tickets are missing this round. */
  unreachable: string[];
}

/** Possible duplicate accounts (same phone, e-mail, or name and birth date) per panel, for the red alert. */
export interface FraudAlertPanel {
  panel: string;
  /** Groups of two or more accounts that share a value, per rule. */
  groups: Partial<Record<'phone' | 'email' | 'name_dob', number>>;
  /** Groups with an account that signed up since the admin last looked. */
  fresh: number;
  /** The newest sign-up in a group, if any. */
  latestAt: string | null;
  /** True when the panel found more groups than it listed. */
  more: boolean;
}
export interface FraudAlerts {
  checkedAt: string;
  total: number;
  panels: FraudAlertPanel[];
  unreachable: string[];
}
