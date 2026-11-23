import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PANELS } from '@madp/contracts';
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

export default async function PanellistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let d: PanellistDetail;
  try {
    d = await api<PanellistDetail>(`/panellists/${encodeURIComponent(id)}`);
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
      <Card className="mt-4">
        <CardHeader
          title="Profile answers"
          hint="As received from each panel, with question version and source time"
        />
        {d.hiddenSensitiveAnswers > 0 ? (
          <p className="mx-5 mt-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
            {d.hiddenSensitiveAnswers} health or special-category answers are hidden. Viewing them needs the
            health-data permission.
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
