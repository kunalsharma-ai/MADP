import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, PageHeader, Stat, btn, fmt } from '@/components/ui';
import { SURVEY_TONE, type SurveyRow } from '../shared';
import { Invite, Reconcile, StatusButtons, type ResponseRow } from './survey-actions';

export const metadata: Metadata = { title: 'Survey' };

export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return withPanel(async () => {
    const qs = new URLSearchParams();
    if (sp.status) qs.set('status', sp.status);
    const [s, responses, audiences] = await Promise.all([
      api<SurveyRow>(`/panel/surveys/${encodeURIComponent(id)}`),
      api<{ total: number; page: number; rows: ResponseRow[] }>(
        `/panel/surveys/${encodeURIComponent(id)}/responses?${qs}`,
      ),
      api<{ id: string; name: string; lastCount: number | null }[]>('/panel/audiences').catch(() => []),
    ]);
    const c = s.counts ?? {};
    const invited = Object.values(c).reduce((a, b) => a + b, 0);
    return (
      <>
        <PageHeader
          eyebrow="Surveys"
          title={s.name}
          description={`${s.slug} · ${s.category} · ${s.source} · ${fmt(s.points)} points · ${s.loi} minutes${s.minQualityScore != null ? ` · quality ${s.minQualityScore}+` : ''}`}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={SURVEY_TONE[s.status] ?? 'neutral'}>{s.status === 'active' ? 'live' : s.status}</Badge>
          {s.link ? (
            <span className="font-mono text-[12px] text-fg-3">{s.link}</span>
          ) : (
            <span className="text-[12px] text-warn">No link yet</span>
          )}
          <span className="ml-auto" />
          <StatusButtons id={s.id} status={s.status} />
          <Link href="/surveys" className={btn.ghost}>
            All surveys
          </Link>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Invited" value={fmt(invited)} />
          <Stat label="Started, not finished" value={fmt(c.dropout ?? 0)} />
          <Stat label="Complete" value={fmt(c.complete ?? 0)} tone="teal" />
          <Stat label="Screened out / over quota" value={fmt((c.terminate ?? 0) + (c.overquota ?? 0))} />
          <Stat label="Rejected at reconciliation" value={fmt(c.rejected ?? 0)} />
        </div>
        <div className="grid gap-4">
          <Invite id={s.id} status={s.status} audiences={audiences} />
          <Card>
            <CardHeader
              title={`${fmt(responses.total)} responses`}
              hint="Approve started responses the client accepted, or reject completes the client turned down. The ledger follows: an approved response pays the survey's points, a rejected one takes them back."
            />
            <div className="flex gap-1 px-5 pt-3 text-[12px]">
              {['', 'invited', 'dropout', 'complete', 'rejected'].map((k) => (
                <Link
                  key={k}
                  href={`/surveys/${s.id}${k ? `?status=${k}` : ''}`}
                  className={`${btn.ghost} ${sp.status === k || (!sp.status && !k) ? 'bg-surface-2 text-fg' : ''}`}
                >
                  {k || 'all'}
                </Link>
              ))}
            </div>
            <Reconcile id={s.id} rows={responses.rows} />
          </Card>
        </div>
      </>
    );
  });
}
