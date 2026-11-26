import type { Metadata } from 'next';
import type { PanelConnectionView } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, PageHeader, PanelChip, fmtDate } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { ConnectionForm, PendingDecision } from './connection-form';

export const metadata: Metadata = { title: 'Panel connections' };

const SOURCE: Record<string, string> = {
  console: 'set here',
  env: 'from server settings',
  none: 'not set',
};

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
            How MADP reaches each panel, set here instead of in server settings. MADP only calls the
            panel&apos;s API over HTTPS and never opens its database. Tokens and secrets are stored encrypted
            and never shown again; you see only whether one is set and its last four characters. Only a Super
            Admin changes a connection, each change needs your authenticator code and a reason, and when
            another Super Admin exists the change waits for them. Turning on live sync is your approval to
            read that panel&apos;s real member data.
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
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-4 text-[13px]">
              <dt className="text-fg-3">Sync address</dt>
              <dd className="min-w-0 break-all font-mono text-[12px]">
                {c.syncBaseUrl.value ?? '—'}
                <Src s={c.syncBaseUrl.source} />
              </dd>
              <dt className="text-fg-3">Sync token</dt>
              <dd>
                {c.syncToken.set ? (
                  <span className="font-mono text-[12px]">set {c.syncToken.hint}</span>
                ) : (
                  '—'
                )}
                <Src s={c.syncToken.source} />
              </dd>
              <dt className="text-fg-3">Admin API address</dt>
              <dd className="min-w-0 break-all font-mono text-[12px]">
                {c.adminBaseUrl.value ?? '—'}
                <Src s={c.adminBaseUrl.source} />
              </dd>
              <dt className="text-fg-3">Admin API secret</dt>
              <dd>
                {c.adminSecret.set ? (
                  <span className="font-mono text-[12px]">set {c.adminSecret.hint}</span>
                ) : (
                  '—'
                )}
                <Src s={c.adminSecret.source} />
              </dd>
              <dt className="text-fg-3">Automatic sync</dt>
              <dd>
                {c.syncIntervalMinutes.value ? `every ${c.syncIntervalMinutes.value} min` : 'off'}
                <Src s={c.syncIntervalMinutes.source} />
              </dd>
              <dt className="text-fg-3">Live sync</dt>
              <dd>
                {c.liveApproved.value ? <Badge tone="teal">On</Badge> : <Badge>Off (DEMO data)</Badge>}
                {c.liveApproved.by ? (
                  <span className="ml-1.5 text-[11px] text-fg-3">
                    approved by {c.liveApproved.by}, {fmtDate(c.liveApproved.at)}
                  </span>
                ) : (
                  <Src s={c.liveApproved.source} />
                )}
              </dd>
              <dt className="text-fg-3">Last test</dt>
              <dd>
                {c.lastTest ? (
                  <span className={c.lastTest.ok ? 'text-teal' : 'text-danger'}>
                    {c.lastTest.ok ? 'Reached' : 'Failed'}: {c.lastTest.message} ({fmtDate(c.lastTest.at)})
                  </span>
                ) : (
                  'Not tested yet'
                )}
              </dd>
            </dl>
            {c.pending ? <PendingDecision connection={c} /> : null}
            {c.canChange && !c.pending ? <ConnectionForm connection={c} /> : null}
          </Card>
        ))}
      </div>
    </>
  );
}
