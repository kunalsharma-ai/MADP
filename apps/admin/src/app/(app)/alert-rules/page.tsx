import type { Metadata } from 'next';
import type { AlertRules } from '@madp/contracts';
import { api } from '@/lib/api';
import { getPanels } from '@/lib/panels';
import { getSegments } from '@/lib/segments';
import { DataModeBadge, PageHeader } from '@/components/ui';
import { RulesBoard } from './rules-board';

export const metadata: Metadata = { title: 'Alert rules' };

export default async function AlertRulesPage() {
  const [data, panels, segments] = await Promise.all([
    api<AlertRules>('/alert-rules'),
    getPanels(),
    getSegments().catch(() => []),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Alert rules"
        description="Your own alarms. Pick a number to watch (new sign-ups, survey completes, redemptions or points redeemed), a panel or all of them, the last hour or the last day, and a limit. When the number goes above or below your limit, the amber siren next to the bell lights up with a short sound. Every admin has their own rules. Counts come from MADP's synced copy of each panel, checked every two minutes while the console is open. Nothing is sent outside the console."
      />
      <div className="mb-3 flex justify-end">
        <DataModeBadge mode={data.dataMode} />
      </div>
      <RulesBoard
        data={data}
        panels={panels.map(({ code, name, shortName }) => ({ code, name, shortName }))}
        segments={segments.filter((s) => s.status === 'active').map(({ key, label }) => ({ key, label }))}
      />
    </>
  );
}
