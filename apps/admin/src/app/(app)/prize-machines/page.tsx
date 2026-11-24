import type { Metadata } from 'next';
import type { PrizeMachineList } from '@madp/contracts';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, PageHeader, fmt, fmtDate } from '@/components/ui';
import { MachineForm } from './machine-form';

export const metadata: Metadata = { title: 'Prize machines' };

const SEGMENT: Record<string, string> = { consumer: 'Consumer', professional: 'Professional', teen: 'Teen' };
const SKIN: Record<string, string> = { claw: 'Claw machine', lift: 'Lift machine', spiral: 'Spiral machine' };
const TONE = { live: 'teal', paused: 'warn', draft: 'neutral' } as const;

export default async function PrizeMachinesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Rewards"
        title="Prize machines"
        description="One machine per segment: the claw for Consumers, the lift for Professionals and the spiral for Teens. Set the prizes, their odds, how many plays a member gets each day and the countries legal has cleared. Members see a machine only while it is live, their country is listed and the Prize machines switch (legal, Super Admin) is on for them. Every save needs a reason and is in the audit log."
        actions={
          <a className="text-[13px] text-accent" href="/switches">
            Feature switches
          </a>
        }
      />
      {await withPanel(async () => {
        const l = await api<PrizeMachineList & { canFlip: boolean }>('/panel/prize-machines');
        return (
          <div className="grid gap-4">
            <p
              className={`rounded-lg border px-4 py-2.5 text-[13px] ${l.switchOn ? 'border-teal/30 bg-teal-soft text-teal' : 'border-warn/30 bg-warn-soft text-warn'}`}
            >
              {l.switchOn
                ? 'The Prize machines switch is on for this brand. Narrower rules on the switch board can still turn it off for a segment or country.'
                : 'The Prize machines switch is off for this brand, so no member sees a machine yet. It stays off until legal clears it and Super Admin turns it on.'}
            </p>
            {l.machines.map((m) => (
              <Card key={m.segment}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {SEGMENT[m.segment]}: {SKIN[m.skin] ?? m.skin}
                      <Badge tone={TONE[m.status]}>{m.exists ? m.status : 'not set up'}</Badge>
                    </span>
                  }
                  hint={
                    m.exists
                      ? `${fmt(m.plays.last30Days)} plays and ${fmt(m.plays.pointsLast30Days)} points paid in the last 30 days. Last change ${fmtDate(m.changedAt)}${m.reason ? `: “${m.reason}”` : ''}.`
                      : 'No machine yet. Fill it in and save it as a draft first.'
                  }
                />
                <MachineForm m={m} />
              </Card>
            ))}
          </div>
        );
      })}
    </>
  );
}
