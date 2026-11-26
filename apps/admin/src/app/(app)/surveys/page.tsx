import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, btn, fmt, input } from '@/components/ui';
import { NewSurvey } from './new-survey';
import { SURVEY_TONE, type SurveyRow } from './shared';
import { DownloadMenu } from '@/components/files';
import { scopeText } from '@/lib/export-scope';

export const metadata: Metadata = { title: 'Surveys' };

export default async function SurveysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ['status', 'category', 'q'] as const) if (sp[k]) qs.set(k, sp[k]!);
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Surveys & invitations"
        description="Surveys of the brand picked at the top. Invitations are always counted in a dry run first. Inviting never sends an e-mail: members see the survey on their dashboard, and e-mail waits for the e-mail switch."
      />
      {await withPanel(async () => {
        const rows = await api<SurveyRow[]>(`/panel/surveys?${qs}`);
        return (
          <div className="grid gap-4">
            <Card>
              <form className="flex flex-wrap items-end gap-3 px-5 py-4 text-[13px]" method="get">
                <label>
                  Search
                  <input name="q" defaultValue={sp.q} className={input} placeholder="Survey name" />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={sp.status ?? ''} className={input}>
                    <option value="">Any</option>
                    <option value="draft">Draft</option>
                    <option value="active">Live</option>
                    <option value="paused">Paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <button className={btn.primary}>Filter</button>
                <Link href="/surveys" className={btn.ghost}>
                  Clear
                </Link>
              </form>
            </Card>
            <Card>
              <CardHeader
                title={`${fmt(rows.length)} surveys`}
                action={
                  <DownloadMenu
                    screen="surveys"
                    title="Surveys"
                    subtitle={scopeText({ search: sp.q, status: sp.status, segment: sp.category })}
                    columns={[
                      { key: 'name', label: 'Survey' },
                      { key: 'slug', label: 'Slug' },
                      { key: 'segment', label: 'Segment' },
                      { key: 'status', label: 'Status' },
                      { key: 'points', label: 'Points', type: 'number' },
                      { key: 'loi', label: 'LOI (min)', type: 'number' },
                      { key: 'minQuality', label: 'Min quality', type: 'number' },
                      { key: 'invited', label: 'Invited', type: 'number' },
                      { key: 'complete', label: 'Complete', type: 'number' },
                      { key: 'screened', label: 'Screened out', type: 'number' },
                      { key: 'rejected', label: 'Rejected', type: 'number' },
                      { key: 'created', label: 'Created', type: 'date' },
                    ]}
                    rows={rows.map((s) => {
                      const c = s.counts ?? {};
                      return {
                        name: s.name,
                        slug: s.slug,
                        segment: s.category,
                        status: s.status === 'active' ? 'live' : s.status,
                        points: s.points,
                        loi: s.loi,
                        minQuality: s.minQualityScore,
                        invited: Object.values(c).reduce((a, b) => a + b, 0),
                        complete: c.complete ?? 0,
                        screened: (c.terminate ?? 0) + (c.overquota ?? 0),
                        rejected: c.rejected ?? 0,
                        created: s.createdAt,
                      };
                    })}
                  />
                }
              />
              {rows.length === 0 ? (
                <EmptyState title="No surveys yet">Create the first one below.</EmptyState>
              ) : (
                <Table
                  head={[
                    'Survey',
                    'Segment',
                    'Status',
                    'Points',
                    'LOI',
                    'Min quality',
                    'Invited',
                    'Complete',
                    'Screened out',
                    'Rejected',
                  ]}
                >
                  {rows.map((s) => {
                    const c = s.counts ?? {};
                    const invited = Object.values(c).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={s.id} className="hover:bg-surface-2">
                        <td className="px-5 py-2.5">
                          <Link href={`/surveys/${s.id}`} className="font-medium text-accent hover:underline">
                            {s.name}
                          </Link>
                          <div className="font-mono text-[11px] text-fg-3">{s.slug}</div>
                        </td>
                        <td className="px-5 py-2.5">{s.category}</td>
                        <td className="px-5 py-2.5">
                          <Badge tone={SURVEY_TONE[s.status] ?? 'neutral'}>
                            {s.status === 'active' ? 'live' : s.status}
                          </Badge>
                        </td>
                        <td className="num px-5 py-2.5">{fmt(s.points)}</td>
                        <td className="num px-5 py-2.5">{s.loi} min</td>
                        <td className="num px-5 py-2.5">{s.minQualityScore ?? '—'}</td>
                        <td className="num px-5 py-2.5">{fmt(invited)}</td>
                        <td className="num px-5 py-2.5">{fmt(c.complete ?? 0)}</td>
                        <td className="num px-5 py-2.5">{fmt((c.terminate ?? 0) + (c.overquota ?? 0))}</td>
                        <td className="num px-5 py-2.5">{fmt(c.rejected ?? 0)}</td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Card>
            <NewSurvey />
          </div>
        );
      })}
    </>
  );
}
