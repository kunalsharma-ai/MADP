import type { Metadata } from 'next';
import { PANEL_CODES, PANELS, SUPPRESSION_REASONS, type BrandKit, type DataMode, type PanelCode } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, fmt, fmtDate } from '@/components/ui';
import { CampaignButtons, NewCampaign, NewTemplate, NewVersion, VersionButtons } from './studio-forms';

export const metadata: Metadata = { title: 'Engagement studio' };

interface Version {
  id: string;
  version: number;
  subject: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
}
interface Template {
  id: string;
  panel: PanelCode;
  key: string;
  name: string;
  kind: string;
  versions: Version[];
}
interface Run {
  startedAt: string;
  counts: { audience: number; planned: number; suppressed: number; delayedByQuietHours: number; reasons: Record<string, number>; consentRequired: string | null } | null;
}
interface Campaign {
  id: string;
  panel: PanelCode;
  name: string;
  kind: string;
  status: string;
  createdAt: string;
  lastRun: Run | null;
}

const REASON_LABELS: Record<string, string> = {
  membership_not_active: 'Membership not active',
  minor_excluded: 'Minor (excluded)',
  no_consent: 'No consent on record',
  no_email: 'No usable e-mail',
  opted_out: 'Opted out',
  bounced_or_complained: 'Bounced or complained',
  already_sent: 'Already sent',
  frequency_cap_week: 'Weekly cap reached',
  frequency_cap_month: 'Monthly cap reached',
};
const TONE: Record<string, 'teal' | 'warn' | 'danger' | 'neutral'> = {
  approved: 'teal',
  in_review: 'warn',
  rejected: 'danger',
  paused: 'warn',
};

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const sp = await searchParams;
  const panel = (PANEL_CODES as readonly string[]).includes(sp.panel ?? '') ? (sp.panel as PanelCode) : undefined;
  const qs = panel ? `?panel=${panel}` : '';
  const [tpl, camp] = await Promise.all([
    api<{ brandKits: Record<PanelCode, BrandKit>; items: Template[] }>(`/communications/templates${qs}`),
    api<{ dataMode: DataMode; sendingEnabled: boolean; items: Campaign[] }>(`/communications/campaigns${qs}`),
  ]);
  const approved = tpl.items.flatMap((t) =>
    t.versions.filter((v) => v.status === 'approved').map((v) => ({ id: v.id, label: `${t.panel.toUpperCase()} · ${t.name} v${v.version}` })),
  );
  return (
    <>
      <PageHeader
        eyebrow="Engagement"
        title="Engagement studio"
        description="Templates and campaigns for each panel's own brand. A second person approves every template version and campaign. Runs are dry runs: they show who would get a message, when, and why others would not. Nothing is sent."
        actions={
          <>
            <DataModeBadge mode={camp.dataMode} />
            <Badge tone="warn">Sending off</Badge>
          </>
        }
      />
      <DemoBanner mode={camp.dataMode} />
      <form method="get" className="mb-4 flex items-center gap-2">
        <select name="panel" defaultValue={panel ?? ''} aria-label="Panel" className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <option value="">All panels</option>
          {PANEL_CODES.map((p) => (
            <option key={p} value={p}>
              {PANELS[p].name}
            </option>
          ))}
        </select>
        <button className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">Show</button>
      </form>
      {PANEL_CODES.some((p) => !tpl.brandKits[p].confirmed) ? (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
          Sender, footer, logo and colours are not confirmed for{' '}
          {PANEL_CODES.filter((p) => !tpl.brandKits[p].confirmed).map((p) => PANELS[p].shortName).join(', ')}. Previews show
          placeholders until each panel owner supplies them.
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Templates" hint="Approved versions never change; edits make a new version" action={<NewTemplate />} />
          {tpl.items.length === 0 ? (
            <EmptyState title="No templates yet">Create one for a panel to start.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {tpl.items.map((t) => (
                <li key={t.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <PanelChip panel={t.panel} />
                    <span className="font-medium">{t.name}</span>
                    <span className="font-mono text-[11px] text-fg-3">{t.key}</span>
                    <Badge>{t.kind.replace('_', ' ')}</Badge>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {t.versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="w-8 text-fg-3">v{v.version}</span>
                        <span className="min-w-0 flex-1 truncate">{v.subject}</span>
                        <Badge tone={TONE[v.status] ?? 'neutral'}>{v.status.replace('_', ' ')}</Badge>
                        <VersionButtons id={v.id} status={v.status} />
                      </li>
                    ))}
                  </ul>
                  <NewVersion templateId={t.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Campaigns" hint="Approved by a second person before any run" action={<NewCampaign versions={approved} />} />
          {camp.items.length === 0 ? (
            <EmptyState title="No campaigns yet">A campaign needs an approved template version.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {camp.items.map((c) => (
                <li key={c.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <PanelChip panel={c.panel} />
                    <span className="font-medium">{c.name}</span>
                    <Badge>{c.kind.replace('_', ' ')}</Badge>
                    <Badge tone={TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                    <span className="ml-auto">
                      <CampaignButtons id={c.id} status={c.status} />
                    </span>
                  </div>
                  {c.lastRun?.counts ? (
                    <div className="mt-2 text-[12px] text-fg-2">
                      <p>
                        Last dry run {fmtDate(c.lastRun.startedAt)}: {fmt(c.lastRun.counts.planned)} of {fmt(c.lastRun.counts.audience)} would get it
                        {c.lastRun.counts.delayedByQuietHours ? `, ${fmt(c.lastRun.counts.delayedByQuietHours)} held until after quiet hours` : ''}.
                        {c.lastRun.counts.consentRequired ? ` Needs consent: ${c.lastRun.counts.consentRequired}.` : ''}
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-fg-3">
                        {SUPPRESSION_REASONS.filter((r) => c.lastRun!.counts!.reasons[r]).map((r) => (
                          <li key={r}>
                            {REASON_LABELS[r]}: {fmt(c.lastRun!.counts!.reasons[r])}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
