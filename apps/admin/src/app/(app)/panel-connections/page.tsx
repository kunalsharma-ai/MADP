import type { Metadata } from 'next';
import type { PanelConnectionView } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, PageHeader, PanelChip, fmtDate } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { ConnectionForm, PendingDecision } from './connection-form';
import { ContractCard } from './contract-card';
import type { ReactNode } from 'react';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { Ring } from '@/components/dashboard/fx';
import { PANEL_TONES } from '@/lib/panel-tones';

/** The required steps: address, token, a passing test, and live sync. The admin API is optional. */
const steps = (c: PanelConnectionView) => [!!c.syncBaseUrl.value, c.syncToken.set, !!c.lastTest?.ok, c.liveApproved.value];

export const metadata: Metadata = { title: 'Panel connections' };

const SOURCE: Record<string, string> = {
  console: 'set here',
  env: 'from server settings',
  none: 'not set',
};

function Step({ done, warn, title, children }: { done: boolean; warn?: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-2">
      <span
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
          done ? 'bg-teal-soft text-teal' : warn ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-fg-3'
        }`}
        aria-hidden
      >
        {done ? <CheckCircle2 className="size-4" /> : warn ? <XCircle className="size-4" /> : <Circle className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-fg">
          {title} <span className="sr-only">{done ? '(done)' : '(not done)'}</span>
        </p>
        <div className="text-[12px] text-fg-2">{children}</div>
      </div>
    </li>
  );
}

function Src({ s }: { s: string }) {
  return <span className="ml-1.5 text-[11px] text-fg-3">({SOURCE[s] ?? s})</span>;
}

export default async function PanelConnectionsPage() {
  const { panels } = await api<{ panels: PanelConnectionView[] }>('/panel-connections');
  return (
    <>
      <PageHeader
        eyebrow="Connectors"
        title="Panel connections"
        description={
          <>
            Connect each panel here: add its address and token, test it, then turn on live sync. A green tick
            means the step is done. Tokens are stored encrypted and only their last four characters are shown.
            Each change needs your authenticator code and a reason, and waits for a second Super Admin when there
            is one. Turning on live sync is your approval to read that panel&apos;s real member data. Every panel
            talks to MADP through one API contract: &ldquo;Check contract&rdquo; reads what the panel offers, and
            &ldquo;Run conformance&rdquo; tests it without changing anything.
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {panels.map((c) => (
          <Card key={c.panel}>
            <CardHeader
              title={
                <span className="flex items-center gap-2.5">
                  <BrandLogo panel={c.panel} size={36} />
                  {c.name}
                </span>
              }
              hint={<span>{c.reason}</span>}
              action={
                <span className="flex items-center gap-1.5">
                  <DataModeBadge mode={c.dataMode} />
                  <PanelChip panel={c.panel} />
                </span>
              }
            />
            <div className="flex items-center gap-4 px-5 pt-4">
              <Ring
                value={steps(c).filter(Boolean).length}
                max={steps(c).length}
                size={64}
                stroke={8}
                from={PANEL_TONES[c.panel]?.[0] ?? '#6366f1'}
                to={PANEL_TONES[c.panel]?.[1] ?? '#a855f7'}
                label={`${steps(c).filter(Boolean).length} of ${steps(c).length} steps done`}
              >
                <span className="text-[13px] font-bold">
                  {steps(c).filter(Boolean).length}/{steps(c).length}
                </span>
              </Ring>
              <p className="text-[13px] text-fg-2">
                {c.liveApproved.value && c.lastTest?.ok
                  ? 'Connected and syncing real data.'
                  : steps(c).every(Boolean)
                    ? 'Ready.'
                    : 'Not ready yet. Work down the steps below.'}
              </p>
            </div>
            <ol className="divide-y divide-border px-5 pb-2">
              <Step done={!!c.syncBaseUrl.value} title="1. Sync address">
                <span className="break-all font-mono text-[11.5px]">{c.syncBaseUrl.value ?? 'Not set'}</span>
                <Src s={c.syncBaseUrl.source} />
              </Step>
              <Step done={c.syncToken.set} title="2. Sync token">
                {c.syncToken.set ? <span className="font-mono text-[11.5px]">Set, ends {c.syncToken.hint}</span> : 'Not set'}
                <Src s={c.syncToken.source} />
              </Step>
              <Step done={!!c.adminBaseUrl.value && c.adminSecret.set} title="3. Admin API (optional, for panel admin screens)">
                <span className="break-all font-mono text-[11.5px]">{c.adminBaseUrl.value ?? 'No address'}</span>
                <Src s={c.adminBaseUrl.source} />
                {' · '}
                {c.adminSecret.set ? <span className="font-mono text-[11.5px]">secret ends {c.adminSecret.hint}</span> : 'no secret'}
                <Src s={c.adminSecret.source} />
              </Step>
              <Step done={!!c.lastTest?.ok} warn={c.lastTest ? !c.lastTest.ok : false} title="4. Connection test">
                {c.lastTest ? (
                  <span className={c.lastTest.ok ? 'text-teal' : 'text-danger'}>
                    {c.lastTest.ok ? 'Reached' : 'Failed'}: {c.lastTest.message} ({fmtDate(c.lastTest.at)})
                  </span>
                ) : (
                  'Not tested yet'
                )}
              </Step>
              <Step done={c.liveApproved.value} title="5. Live sync">
                {c.liveApproved.value ? <Badge tone="teal">On</Badge> : <Badge>Off, showing DEMO data</Badge>}
                {c.liveApproved.by ? (
                  <span className="ml-1.5 text-[11px] text-fg-3">
                    approved by {c.liveApproved.by}, {fmtDate(c.liveApproved.at)}
                  </span>
                ) : (
                  <Src s={c.liveApproved.source} />
                )}
                <span className="ml-1.5">
                  · Automatic sync{' '}
                  {c.syncIntervalMinutes.value ? `every ${c.syncIntervalMinutes.value} min` : 'off'}
                </span>
              </Step>
            </ol>
            <ContractCard connection={c} />
            {c.pending ? <PendingDecision connection={c} /> : null}
            {c.canChange && !c.pending ? <ConnectionForm connection={c} /> : null}
          </Card>
        ))}
      </div>
    </>
  );
}
