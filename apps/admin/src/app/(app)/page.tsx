import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type AudienceCategory, type PanelCode, type SessionUser } from '@madp/contracts';
import { getSegments } from '@/lib/segments';
import { api } from '@/lib/api';
import type { DashboardSummary } from '@/lib/types';
import {
  Badge,
  Card,
  CardHeader,
  DataModeBadge,
  DemoBanner,
  PageHeader,
  PanelChip,
  Stat,
  fmt,
  fmtDate,
} from '@/components/ui';
import { RegistrationsChart } from '@/components/charts';

export const metadata: Metadata = { title: 'Executive dashboard' };

export default async function Dashboard() {
  const segmentList = await getSegments();
  const SEG_KEYS = segmentList.map((s) => s.key);
  const SEG_LABEL: Record<string, string> = Object.fromEntries(segmentList.map((s) => [s.key, s.label]));
  const panelList = await getPanels();
  const me = await api<SessionUser>('/auth/me');
  // The executive dashboard spans every brand. Admins limited to some brands start on their brand's screens instead.
  if (!me.permissions.includes('dashboard.read')) {
    return (
      <>
        <PageHeader eyebrow="Overview" title={`Welcome, ${me.displayName}`} />
        <Card>
          <div className="px-5 py-4 text-sm text-fg-2">
            You work in {me.brands.map((b) => panelName(b, panelList)).join(', ')}. The menu on the left shows the screens your roles
            allow for the brand picked at the top. The cross-brand executive dashboard needs access to every brand.
          </div>
        </Card>
      </>
    );
  }
  const d = await api<DashboardSummary>('/dashboard/summary');
  const c = d.counts;
  const overlap = c.panelMemberships - c.uniquePeople;
  const empty = c.uniquePeople === 0;
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Executive dashboard"
        description="Unique people are counted once across all panels. Panel and category memberships are shown separately, so nobody is double-counted."
        actions={<DataModeBadge mode={d.dataMode} />}
      />
      <DemoBanner mode={d.dataMode} />
      {empty ? (
        <Card className="mb-6 p-6 text-sm text-fg-2">
          No audience data yet. Run an import from{' '}
          <Link className="text-accent underline-offset-2 hover:underline" href="/connectors">
            Connectors &amp; sync
          </Link>
          .
        </Card>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Unique people"
          value={fmt(c.uniquePeople)}
          tone="accent"
          hint="Distinct master persons with an active membership"
        />
        <Stat
          label="Panel memberships"
          value={fmt(c.panelMemberships)}
          hint={`${fmt(overlap)} are second or third memberships of the same person`}
        />
        <Stat
          label="Category memberships"
          value={fmt(c.categoryMemberships)}
          hint="A person can hold several categories"
        />
        <Stat
          label="Verified e-mail"
          value={fmt(d.kpis.verifiedPeople)}
          tone="teal"
          hint={
            c.uniquePeople
              ? `${Math.round((d.kpis.verifiedPeople / c.uniquePeople) * 100)}% of unique people`
              : undefined
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Registrations by month" hint="Source account creation date, per panel" />
          <div className="px-3 pt-3 pb-1">
            <RegistrationsChart
              rows={d.registrationsByMonth}
              label="Stacked bar chart of registrations per month for each panel"
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Needs attention" />
          <ul className="divide-y divide-border text-[13px]">
            <li className="flex items-center justify-between px-5 py-3">
              <Link href="/mappings" className="hover:text-accent">
                Question mappings awaiting review
              </Link>
              <Badge tone={d.kpis.pendingMappings ? 'warn' : 'neutral'}>{fmt(d.kpis.pendingMappings)}</Badge>
            </li>
            <li className="flex items-center justify-between px-5 py-3">
              <span>Identity matches awaiting review</span>
              <Badge tone={d.kpis.pendingIdentityMatches ? 'warn' : 'neutral'}>
                {fmt(d.kpis.pendingIdentityMatches)}
              </Badge>
            </li>
            <li className="flex items-center justify-between px-5 py-3">
              <span>People in more than one panel</span>
              <span className="num font-medium">{fmt(d.kpis.multiPanelPeople)}</span>
            </li>
            <li className="flex items-center justify-between px-5 py-3">
              <span>New registrations, last 30 days</span>
              <span className="num font-medium">{fmt(d.kpis.newRegistrationsLast30Days)}</span>
            </li>
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="By panel" hint="Unique people per panel" />
          <ul className="divide-y divide-border">
            {panelList.map((x) => x.code).map((p) => {
              const cell = c.byPanel.find((x) => x.key === p);
              const conn = d.connectors.find((x) => x.panel === p)!;
              return (
                <li key={p} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                  <div className="flex items-center gap-2">
                    <PanelChip panel={p} />
                    <span>{panelName(p, panelList)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DataModeBadge mode={conn.dataMode} />
                    {/* A small panel is suppressed like any other cell; showing 0 would contradict the total. */}
                    {cell?.suppressed ? (
                      <Badge>&lt; min cell</Badge>
                    ) : (
                      <span className="num w-16 text-right font-medium">{fmt(cell?.value ?? 0)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHeader title="By audience category" hint="Overlapping: a person may be in several" />
          <Bars
            rows={c.byCategory.map((x) => ({
              label: (SEG_LABEL[x.key as AudienceCategory] ?? x.key as AudienceCategory) ?? x.key,
              value: x.value,
              suppressed: x.suppressed,
            }))}
          />
        </Card>
        <Card>
          <CardHeader
            title="Top countries"
            hint={`Cells under ${c.minimumCellSize} are suppressed`}
            action={
              <Link href="/audience" className="text-xs text-accent hover:underline">
                Explore
              </Link>
            }
          />
          <Bars
            rows={c.byCountry
              .slice(0, 7)
              .map((x) => ({ label: x.key.toUpperCase(), value: x.value, suppressed: x.suppressed }))}
          />
        </Card>
      </div>
      <p className="mt-4 text-xs text-fg-3">
        Computed {fmtDate(c.computedAt)} · oldest panel sync {fmtDate(c.oldestSourceSyncAt)} · questions in
        registry: T2O {fmt(d.questionsByPanel.t2o ?? 0)}, MFR {fmt(d.questionsByPanel.mfr ?? 0)}, MHO{' '}
        {fmt(d.questionsByPanel.mho ?? 0)}
      </p>
    </>
  );
}

function Bars({ rows }: { rows: { label: string; value: number | null; suppressed: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  if (!rows.length) return <p className="px-5 py-6 text-sm text-fg-3">No data yet.</p>;
  return (
    <ul className="space-y-2.5 px-5 py-4">
      {rows.map((r) => (
        <li key={r.label} className="text-[13px]">
          <div className="flex justify-between">
            <span>{r.label}</span>
            <span className="num font-medium">
              {r.suppressed ? <Badge>&lt; min cell</Badge> : fmt(r.value)}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-2">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-accent to-teal"
              style={{ width: `${((r.value ?? 0) / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
