'use server';

import { unstable_rethrow } from 'next/navigation';
import type { ActivityFeed, FraudAlerts, NewMembersSummary } from '@madp/contracts';
import { api } from '@/lib/api';
import { getSegments } from '@/lib/segments';
import { setBrand } from './super-admin-actions';

export type NewMembersView = NewMembersSummary & { segmentLabels: Record<string, string> };

/** New sign-ups per panel and segment since this admin last marked them seen. Polled by the bell. */
export async function newMembersAction(): Promise<NewMembersView | null> {
  try {
    const [summary, segments] = await Promise.all([
      api<NewMembersSummary>('/new-members'),
      getSegments().catch(() => []),
    ]);
    return { ...summary, segmentLabels: Object.fromEntries(segments.map((s) => [s.key, s.label])) };
  } catch (e) {
    unstable_rethrow(e);
    // A blip (API restarting) must not break the page; the bell tries again on its next round.
    return null;
  }
}

export async function markNewMembersSeenAction(panel?: string) {
  await api('/new-members/seen', { method: 'POST', json: panel ? { panel } : {} });
}

/** "See them": picks the panel's brand, then the Members screen lists the newest sign-ups first. */
export async function openNewMembersAction(panel: string) {
  await setBrand(panel);
}

/** The live activity feed: sign-ups, survey completes, redemptions and new tickets on every panel the admin sees. */
export async function activityAction(): Promise<ActivityFeed | null> {
  try {
    return await api<ActivityFeed>('/activity?limit=60');
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}

/** Possible duplicate accounts per panel, for the red alert next to the bell. */
export async function fraudAlertsAction(): Promise<FraudAlerts | null> {
  try {
    return await api<FraudAlerts>('/fraud-alerts');
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}

export async function markFraudSeenAction(panel?: string) {
  await api('/fraud-alerts/seen', { method: 'POST', json: panel ? { panel } : {} });
}
