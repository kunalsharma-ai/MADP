import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HEALTH_ACCESS_PURPOSE_LABELS, HealthAccessPurpose } from '@madp/contracts';
import { api, ApiError } from '@/lib/api';
import type { PanellistDetail } from '@/lib/types';
import {
  Badge,
  Card,
  CardHeader,
  CategoryChip,
  DataModeBadge,
  DemoBanner,
  PageHeader,
  PanelChip,
  Table,
  fmt,
  fmtDate,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Panellist profile' };

const CONSENT_PURPOSE_LABELS: Record<string, string> = {
  guardian_consent: 'Parent or guardian consent',
  terms: 'Terms accepted',
  push_notifications: 'Push notifications',
  video_sharing: 'Video sharing',
  gps_sharing: 'Location sharing',
};
const CONSENT_TONE = { granted: 'teal', denied: 'danger', withdrawn: 'warn', unknown: 'neutral' } as const;

export default async function PanellistPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ purpose?: string }>;
}) {
  const panelList = await getPanels();
  const { id } = await params;
  const sp = await searchParams;
  const purpose = HealthAccessPurpose.safeParse(sp.purpose).data;
  let d: PanellistDetail;
  try {
    d = await api<PanellistDetail>(
      `/panellists/${encodeURIComponent(id)}${purpose ? `?purpose=${encodeURIComponent(purpose)}` : ''}`,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const byPanel = Object.groupBy(d.answers, (a) => a.panel);
  type Timeline = {
    items: { id: string; panel: string; state: string; reason: string | null; dryRun: boolean; plannedFor: string | null; occurredAt: string; campaign: string | null; automation?: string | null; step?: number | null }[];
    fatigue: { panel: string; score: number | null; band: string; factors: { factor: string; value: number; points: number }[] }[];
  };
  // Only roles with communications.read see the timeline; others get the profile without it.
  const timeline = await api<Timeline>(`/communications/timeline/${encodeURIComponent(id)}?limit=50`).catch(() => null);
  type Wallets = {
    accounts: {
      panel: string;
      membershipStatus: string;
      balances: { approved: number; pending: number; reversed: number; redeemed: number };
      surveys: Record<string, number>;
      lines: { id: number; bucket: string; points: number; entryKind: string; category: string; reference: string | null; sourceStatus: string | null; recordedAt: string }[];
    }[];
  };
  // Only roles with loyalty.read see the wallets.
  const wallets = await api<Wallets>(`/loyalty/persons/${encodeURIComponent(id)}`).catch(() => null);
  return (
    <>
      <PageHeader
        eyebrow="Audience · 360° profile"
        title={`Person ${d.person.id.slice(0, 8)}`}
        description={[d.person.city, d.person.state, d.person.country?.toUpperCase()]
          .filter(Boolean)
          .join(', ')}
        actions={
          <>
            <DataModeBadge mode={d.dataMode} />
            {!d.access.pii ? <Badge>PII masked</Badge> : <Badge tone="warn">PII visible · view logged</Badge>}
          </>
        }
      />
      <DemoBanner mode={d.dataMode} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Panel accounts"
            hint="Each panel keeps its own ID, rewards and communication choices"
          />
          <Table
            head={[
              'Panel',
              'Member',
              'Source category',
              'E-mail',
              'Name',
              'E-mail status',
              'Quality',
              'Joined',
            ]}
          >
            {d.identities.map((i) => (
              <tr key={i.id}>
                <td className="px-5 py-2.5">
                  <PanelChip panel={i.panel} />
                </td>
                <td className="px-5 py-2.5 font-mono text-xs whitespace-nowrap">
                  {i.sourceRespondentRef ?? i.sourceMemberId}
                </td>
                <td className="px-5 py-2.5">{i.sourceCategory}</td>
                <td className="px-5 py-2.5 font-mono text-xs">{i.email ?? '—'}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">{i.name ?? '—'}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={i.emailVerification === 'verified' ? 'teal' : 'neutral'}>
                    {i.emailVerification}
                  </Badge>
                </td>
                <td className="num px-5 py-2.5">{i.qualityScore ?? '—'}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">{fmtDate(i.sourceCreatedAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Audience categories" />
          <ul className="space-y-2 px-5 py-4 text-[13px]">
            {d.categories.map((c) => (
              <li key={`${c.panel}-${c.category}`} className="flex items-center justify-between gap-2">
                <CategoryChip category={c.category} />
                <span className="text-xs text-fg-3">
                  {panelShort(c.panel, panelList)} · {c.basis}
                  {c.isMinor ? ' · minor' : ''}
                </span>
              </li>
            ))}
          </ul>
          {d.identityCandidates.length ? (
            <div className="border-t border-border px-5 py-3 text-[12px] text-fg-2">
              {d.identityCandidates.map((c) => (
                <p key={c.id}>
                  Identity link · {c.rule.replaceAll('_', ' ')} ·{' '}
                  <Badge tone={c.status === 'approved' ? 'teal' : 'warn'}>
                    {c.status === 'approved' ? 'auto-linked (reversible)' : 'awaiting review'}
                  </Badge>
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
      {d.consents.length ? (
        <Card className="mt-4">
          <CardHeader
            title="Consent"
            hint="As recorded by each panel at the last sync. Guardian details stay on the panel."
          />
          <Table head={['Panel', 'Purpose', 'Status', 'Version', 'Recorded']}>
            {d.consents.map((c) => (
              <tr key={`${c.panel}-${c.purpose}`}>
                <td className="px-5 py-2.5">
                  <PanelChip panel={c.panel} />
                </td>
                <td className="px-5 py-2.5">{CONSENT_PURPOSE_LABELS[c.purpose] ?? c.purpose}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={CONSENT_TONE[c.status]}>{c.status}</Badge>
                </td>
                <td className="px-5 py-2.5 font-mono text-xs">{c.version ?? '—'}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">{fmtDate(c.capturedAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
      <Card className="mt-4">
        <CardHeader
          title="Profile answers"
          hint="As received from each panel, with question version and source time"
        />
        {d.hiddenSensitiveAnswers > 0 && d.access.healthPurposeRequired ? (
          <form method="get" className="mx-5 mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
            <span>
              {d.hiddenSensitiveAnswers} health or special-category answers are hidden. Say why you need them; the
              reason is kept in the audit log.
            </span>
            <select name="purpose" required aria-label="Purpose" className="rounded-md border border-border bg-surface px-2 py-1">
              <option value="">Choose a purpose…</option>
              {HealthAccessPurpose.options.map((k) => (
                <option key={k} value={k}>
                  {HEALTH_ACCESS_PURPOSE_LABELS[k]}
                </option>
              ))}
            </select>
            <button className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium">Show</button>
          </form>
        ) : d.hiddenSensitiveAnswers > 0 ? (
          <p className="mx-5 mt-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
            {d.hiddenMinorAnswers > 0
              ? `${d.hiddenMinorAnswers} health answers stay hidden because this member is a minor and the guardian has not consented on that panel.`
              : `${d.hiddenSensitiveAnswers} health or special-category answers are hidden. Viewing them needs the health-data permission.`}
          </p>
        ) : null}
        {d.access.purpose ? (
          <p className="mx-5 mt-4 text-[12px] text-fg-3">
            Health answers shown for: {HEALTH_ACCESS_PURPOSE_LABELS[d.access.purpose as HealthAccessPurpose]}. This view is logged.
          </p>
        ) : null}
        {Object.entries(byPanel).map(([panel, answers]) => (
          <div key={panel} className="px-5 py-4">
            <p className="mb-2 text-xs font-medium text-fg-3">{panelName(panel as string, panelList)}</p>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
              {answers!.map((a) => (
                <div key={a.sourceQuestionId} className="rounded-lg border border-border px-3 py-2">
                  <dt className="text-[11px] text-fg-3">
                    {a.label ?? a.sourceQuestionId} <span className="font-mono">· v{a.questionVersion}</span>{' '}
                    {a.sensitivity === 'special_category' ? (
                      <Badge tone="danger">{a.panel === 'mho' ? 'health' : 'special category'}</Badge>
                    ) : null}
                  </dt>
                  <dd className="mt-0.5 text-[13px]">{a.values.join(', ')}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {d.answers.length === 0 ? <p className="px-5 py-6 text-sm text-fg-3">No answers visible.</p> : null}
      </Card>
      {timeline ? (
        <Card className="mt-4">
          <CardHeader title="Communication timeline" hint="Per panel. Dry-run lines show what a campaign would do; nothing was sent." />
          {timeline.fatigue.length ? (
            <div className="flex flex-wrap gap-4 px-5 pt-4 text-[12px] text-fg-2">
              {timeline.fatigue.map((f) => (
                <div key={f.panel}>
                  <span className="font-medium">{panelShort(f.panel, panelList)} contact load: {f.band}</span>
                  {f.score !== null ? ` (${f.score})` : ''}
                  <span className="text-fg-3"> · {f.factors.map((x) => `${x.factor}: ${x.value}`).join(' · ')}</span>
                </div>
              ))}
            </div>
          ) : null}
          {timeline.items.length ? (
            <ul className="divide-y divide-border">
              {timeline.items.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-[13px]">
                  <PanelChip panel={e.panel} />
                  <span>{e.campaign ?? (e.automation ? `${e.automation}${e.step !== null && e.step !== undefined ? ` · day ${e.step}` : ''}` : 'Message')}</span>
                  <Badge tone={e.state === 'suppressed' ? 'warn' : 'neutral'}>{e.state}</Badge>
                  {e.reason ? <span className="text-fg-3">{e.reason.replaceAll('_', ' ')}</span> : null}
                  {e.dryRun ? <Badge>dry run</Badge> : null}
                  <span className="ml-auto text-[12px] text-fg-3">
                    {e.plannedFor ? `for ${fmtDate(e.plannedFor)}` : fmtDate(e.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-fg-3">No messages yet.</p>
          )}
        </Card>
      ) : null}
      {wallets?.accounts.length ? (
        <Card className="mt-4">
          <CardHeader title="Reward wallets" hint="One per panel, mirrored read-only from the panel and never added together. Survey completes stay pending until the client approves them." />
          <ul className="divide-y divide-border">
            {wallets.accounts.map((a) => (
              <li key={a.panel} className="px-5 py-4 text-[13px]">
                <div className="flex flex-wrap items-center gap-3">
                  <PanelChip panel={a.panel} />
                  <span>
                    <span className="font-medium">{fmt(a.balances.approved)}</span> approved
                  </span>
                  <span className="text-fg-2">{fmt(a.balances.pending)} pending</span>
                  {a.balances.reversed ? <span className="text-fg-3">{fmt(a.balances.reversed)} reversed</span> : null}
                  <span className="text-fg-3">
                    Surveys: {Object.entries(a.surveys).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}
                  </span>
                  {a.membershipStatus !== 'active' ? <Badge tone="warn">membership {a.membershipStatus}</Badge> : null}
                </div>
                <ul className="mt-2 space-y-0.5 text-[12px] text-fg-2">
                  {a.lines.slice(0, 8).map((l) => (
                    <li key={l.id} className="flex flex-wrap gap-2">
                      <span className="w-14 text-right font-mono">{l.points > 0 ? `+${l.points}` : l.points}</span>
                      <span className="w-20">{l.bucket}</span>
                      <span>{l.category}{l.reference ? ` · ${l.reference}` : ''}</span>
                      {l.entryKind === 'approval' ? <Badge tone="teal">client approval</Badge> : null}
                      <span className="ml-auto text-fg-3">{fmtDate(l.recordedAt)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
