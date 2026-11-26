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
