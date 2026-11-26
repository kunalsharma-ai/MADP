import type { Metadata } from 'next';
import Link from 'next/link';
import type { DataMode, PanelCode } from '@madp/contracts';
import { CheckCircle2, Coins, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { getPanels } from '@/lib/panels';
import { panelName } from '@/lib/panel-names';
import { PANEL_TONES } from '@/lib/panel-tones';
import { BrandLogo } from '@/components/brand-logo';
import { CountUp, Ring } from '@/components/dashboard/fx';
import { PanelPills, StatusTabs } from '@/components/filters';
import {
  Badge,
  BarList,
  Card,
  CardHeader,
  DataModeBadge,
  DemoBanner,
  EmptyState,
  PageHeader,
  Pager,
  PanelChip,
  Table,
  btn,
  fmt,
  fmtDate,
  input,
} from '@/components/ui';
import { STATUS_LABEL, STATUS_TONE, statusLabel } from './status';
import { HELP, Titled } from './help';
import { TopicInfo } from '@/components/screen-info';

export const metadata: Metadata = { title: 'Survey participation' };

interface Row {
  id: string;
  panel: PanelCode;
  personId: string;
  memberRef: string | null;
  surveySlug: string | null;
  status: string;
  points: number;
  loi: number | null;
  startedAt: string | null;
  endedAt: string | null;
}
interface Summary {
  dataMode: DataMode;
  panels: {
    panel: PanelCode;
    byStatus: Record<string, number>;
    points: number;
    members: number;
    activeLast30Days: number;
    completeRate: number | null;
  }[];
  topSurveys: { panel: PanelCode; surveySlug: string; attempts: number; completes: number }[];
}

const SIZE = 50;

export default async function ParticipationPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; status?: string; survey?: string; page?: string }>;
}) {
  const panelList = await getPanels();
  const sp = await searchParams;
  const panel = panelList.some((p) => p.code === sp.panel) ? sp.panel : undefined;
  const status = /^[a-z_]{1,40}$/.test(sp.status ?? '') ? sp.status : undefined;
  const survey = sp.survey?.trim().slice(0, 200) || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const base = new URLSearchParams();
  if (panel) base.set('panel', panel);
  if (survey) base.set('survey', survey);
  const listQs = new URLSearchParams(base);
  if (status) listQs.set('status', status);
  listQs.set('page', String(page));
  listQs.set('size', String(SIZE));
  const [sum, list] = await Promise.all([
    api<Summary>(`/participation/summary?${base}`),
    api<{ dataMode: DataMode; total: number; items: Row[] }>(`/participation?${listQs}`),
  ]);
  const order = (code: string) => {
    const i = panelList.findIndex((x) => x.code === code);
    return i < 0 ? 99 : i;
  };
  const totals: Record<string, number> = {};
  for (const p of sum.panels) for (const [k, v] of Object.entries(p.byStatus)) totals[k] = (totals[k] ?? 0) + v;
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  const tabs = [
    { key: '', label: 'All', count: all },
    ...Object.keys(STATUS_LABEL)
      .filter((k) => totals[k])
      .map((k) => ({ key: k, label: STATUS_LABEL[k]!, count: totals[k] })),
    ...Object.keys(totals)
      .filter((k) => !(k in STATUS_LABEL))
      .map((k) => ({ key: k, label: statusLabel(k), count: totals[k] })),
  ];
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Survey participation"
        description="Every survey each member took on Turn2Opinion, MyFrequentRewards and MyHealthOpinions: the result, the points it earned and when. Click a member to see their full history and engagement."
        actions={<DataModeBadge mode={list.dataMode} />}
      />
      <DemoBanner mode={list.dataMode} />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {sum.panels.length === 0 ? (
          <Card className="lg:col-span-3">
            <EmptyState title="No survey responses yet">
              They appear here after the next sync of each panel&apos;s rewards and responses.
            </EmptyState>
          </Card>
        ) : (
          [...sum.panels]
            .sort((a, b) => order(a.panel) - order(b.panel))
            .map((p) => {
            const [from, to] = PANEL_TONES[p.panel] ?? ['#818cf8', '#6366f1'];
            const rate = p.completeRate === null ? null : Math.round(p.completeRate * 100);
            return (
              <Card key={p.panel} className="p-5">
                <div className="flex items-center gap-2.5">
                  <BrandLogo panel={p.panel} size={30} />
                  <h2 className="text-[15px] font-bold text-fg">
                    <Titled title={panelName(p.panel, panelList)} help={HELP.panelCard} />
                  </h2>
                </div>
                <div className="mt-4 flex items-center gap-5">
                  <Ring value={rate ?? 0} max={100} size={96} stroke={10} from={from} to={to} label={`Complete rate ${rate ?? 0}%`}>
                    <span className="text-center leading-tight">
                      <span className="block text-[18px] font-bold">{rate === null ? '—' : `${rate}%`}</span>
                      <span className="text-[10px] text-fg-3">complete</span>
                    </span>
                  </Ring>
                  <ul className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                    <Tile icon={CheckCircle2} tone="text-teal" label="Completes" value={p.byStatus.complete ?? 0} />
                    <Tile icon={XCircle} tone="text-danger" label="Terminates" value={p.byStatus.terminate ?? 0} />
                    <Tile icon={Users} tone="text-accent" label="Members" value={p.members} />
                    <Tile icon={Coins} tone="text-warn" label="Points given" value={p.points} />
                  </ul>
                </div>
                <p className="mt-3 text-[12px] text-fg-3">
                  {fmt(p.activeLast30Days)} {p.activeLast30Days === 1 ? 'member' : 'members'} took a survey in the last 30 days.
                </p>
              </Card>
            );
          })
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusTabs path="/participation" current={status ?? ''} params={{ panel, survey }} tabs={tabs} />
        <PanelPills path="/participation" current={panel ?? ''} params={{ status, survey }} panels={panelList} />
        <form method="get" className="flex items-center gap-2">
          {panel ? <input type="hidden" name="panel" value={panel} /> : null}
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input
            name="survey"
            defaultValue={survey ?? ''}
            placeholder="Survey name"
            aria-label="Survey name"
            className={input}
            style={{ width: '12rem' }}
          />
          <button className={btn.secondary}>Find</button>
        </form>
        <TopicInfo title="Filters" help={HELP.filters} align="right" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title={<Titled title="Survey records" help={HELP.records} />} hint={`${fmt(list.total)} records, newest first`} />
          {list.items.length === 0 ? (
            <EmptyState title="Nothing matches">Try another panel, result or survey name.</EmptyState>
          ) : (
            <Table head={['When', 'Panel', 'Member', 'Survey', 'Result', 'Points', 'Length']}>
              {list.items.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-5 py-2.5 text-fg-2">{fmtDate(r.endedAt ?? r.startedAt)}</td>
                  <td className="px-5 py-2.5">
                    <PanelChip panel={r.panel} />
                  </td>
                  <td className="px-5 py-2.5">
                    <Link href={`/panellists/${r.personId}`} className="whitespace-nowrap font-mono text-[12px] text-accent hover:underline">
                      {r.memberRef ?? r.personId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5">{r.surveySlug ?? '—'}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{statusLabel(r.status)}</Badge>
                  </td>
                  <td className="num px-5 py-2.5">{r.points ? `+${fmt(r.points)}` : '0'}</td>
                  <td className="num whitespace-nowrap px-5 py-2.5 text-fg-2">{r.loi ? `${r.loi} min` : '—'}</td>
                </tr>
              ))}
            </Table>
          )}
          <Pager
            total={list.total}
            page={page}
            size={SIZE}
            path="/participation"
            params={{ panel, status, survey }}
          />
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={<Titled title="Most taken surveys" help={HELP.topSurveys} align="right" />} hint="Attempts, for the filters above" />
            <BarList
              rows={sum.topSurveys.map((t) => ({
                key: `${t.panel}:${t.surveySlug}`,
                label: (
                  <span className="flex items-center gap-1.5">
                    <PanelChip panel={t.panel} />
                    <span className="truncate">{t.surveySlug}</span>
                    <span className="text-[11px] text-fg-3">{fmt(t.completes)} done</span>
                  </span>
                ),
                value: t.attempts,
              }))}
              empty="No surveys yet."
            />
          </Card>
          <Card className="p-5">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-fg-3">All three panels</p>
            <p className="mt-1 text-[30px] font-bold leading-none text-fg">
              <CountUp value={all} />
            </p>
            <p className="mt-1 text-[12px] text-fg-2">survey records in total. Each panel keeps its own points.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Tile({ icon: Icon, tone, label, value }: { icon: typeof Users; tone: string; label: string; value: number }) {
  return (
    <li className="flex items-center gap-2">
      <Icon className={`size-4 shrink-0 ${tone}`} aria-hidden />
      <span className="min-w-0">
        <span className="num block font-semibold text-fg">{fmt(value)}</span>
        <span className="text-fg-3">{label}</span>
      </span>
    </li>
  );
}
