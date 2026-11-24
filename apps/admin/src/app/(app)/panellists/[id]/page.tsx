import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HEALTH_ACCESS_PURPOSE_LABELS, HealthAccessPurpose, PANELS } from '@madp/contracts';
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
                  {PANELS[c.panel].shortName} · {c.basis}
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
            <p className="mb-2 text-xs font-medium text-fg-3">{PANELS[panel as keyof typeof PANELS].name}</p>
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
    </>
  );
}
