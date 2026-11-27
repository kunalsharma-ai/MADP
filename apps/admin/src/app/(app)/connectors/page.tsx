import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ConnectorRow, ImportJob, SyncStatus } from '@/lib/types';
import {
  Badge,
  Card,
  CardHeader,
  DataModeBadge,
  PageHeader,
  PanelChip,
  Table,
  fmt,
  fmtDate,
} from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { ImportButtons, RetryDeadLettersButton, SyncNowButton } from './import-buttons';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Connectors & sync' };

const statusTone = { verified: 'teal', partial: 'warn', missing: 'danger', unknown: 'neutral' } as const;

export default async function ConnectorsPage() {
  const [rows, jobs, dead, sync] = await Promise.all([
    api<ConnectorRow[]>('/connectors'),
    api<ImportJob[]>('/imports'),
    api<{ panel: string; memberCount: number }[]>('/dead-letters?status=open'),
    api<SyncStatus>('/sync-status'),
  ]);
  const syncByPanel = new Map(sync.panels.map((p) => [p.panel, p]));
  const deadByPanel = new Map<string, { batches: number; members: number }>();
  for (const d of dead) {
    const cur = deadByPanel.get(d.panel) ?? { batches: 0, members: 0 };
    deadByPanel.set(d.panel, { batches: cur.batches + 1, members: cur.members + d.memberCount });
  }
  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Connectors & sync"
        description="One independent, read-only connector per panel. A connector switches to live data only after access to that panel's production data has been explicitly approved and its credential is configured."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {rows.map((c) => (
          <Card key={c.panel}>
            <CardHeader
              title={
                <span className="flex items-center gap-2.5">
                  <BrandLogo panel={c.panel} size={32} />
                  {c.name}
                </span>
              }
              hint={c.sourceRepository}
              action={
                <div className="flex items-center gap-1.5">
                  <PanelChip panel={c.panel} />
                  <DataModeBadge mode={c.dataMode} />
                </div>
              }
            />
            <div className="space-y-3 px-5 py-4 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-fg-3">Health</span>
                <Badge
                  tone={
                    c.health.state === 'healthy' ? 'teal' : c.health.state === 'degraded' ? 'warn' : 'danger'
                  }
                >
                  {c.health.state}
                </Badge>
              </div>
              <p className="text-fg-2">{c.reason}.</p>
              <div className="flex items-center justify-between">
                <span className="text-fg-3">Last successful sync</span>
                <span>{fmtDate(c.lastSuccessAt)}</span>
              </div>
              {c.pendingCursor ? (
                <p className="rounded-md bg-warn-soft px-2 py-1 text-xs text-warn">
                  An earlier run stopped part-way; the next run resumes from cursor {c.pendingCursor}.
                </p>
              ) : null}
              {c.lastJob ? (
                <div className="flex items-center justify-between">
                  <span className="text-fg-3">Last run</span>
                  <span>
                    <Badge
                      tone={
                        c.lastJob.status === 'succeeded'
                          ? 'teal'
                          : c.lastJob.status === 'failed'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {c.lastJob.status}
                    </Badge>{' '}
                    {c.lastJob.dryRun ? <Badge>dry run</Badge> : null}
                  </span>
                </div>
              ) : null}
              {c.panel === 'mho' ? (
                <p className="rounded-md bg-surface-2 px-2 py-1 text-xs text-fg-2">
                  Health panel: answers default to special-category and need the health-data permission to
                  view.
                </p>
              ) : null}
              {deadByPanel.get(c.panel) ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warn-soft text-warn px-2 py-1.5 text-xs">
                  <span>
                    {fmt(deadByPanel.get(c.panel)!.batches)} answer batch(es) for{' '}
                    {fmt(deadByPanel.get(c.panel)!.members)} members failed after retries
                  </span>
                  <RetryDeadLettersButton panel={c.panel} />
                </div>
              ) : null}
              {(() => {
                const st = syncByPanel.get(c.panel);
                if (!st) return null;
                const run = st.lastRun;
                const n = (run?.counts ?? {}) as Record<string, number>;
                return (
                  <div className="space-y-2 rounded-md border border-border px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Automatic sync</span>
                      <Badge tone={st.scheduled ? 'teal' : 'neutral'}>
                        {st.scheduled ? `every ${sync.intervalMinutes} min` : 'on request'}
                      </Badge>
                    </div>
                    <p className="text-xs text-fg-3">
                      {st.scheduled
                        ? 'Reads only what changed since the last run: members and consent, answers, deletions.'
                        : st.dataMode === 'live'
                          ? 'Set SYNC_INTERVAL_MINUTES to run it on a schedule.'
                          : 'Runs on a schedule only for live panels. On DEMO data it runs when asked.'}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-fg-3">Last sync</span>
                      <span>
                        {run ? (
                          <Badge
                            tone={
                              run.status === 'succeeded'
                                ? 'teal'
                                : run.status === 'failed'
                                  ? 'danger'
                                  : 'warn'
                            }
                          >
                            {run.status === 'cancelled' ? 'feed not available' : run.status}
                          </Badge>
                        ) : (
                          'never'
                        )}{' '}
                        {run ? fmtDate(run.finishedAt ?? run.startedAt) : null}
                      </span>
                    </div>
                    {run?.status === 'succeeded' ? (
                      <p className="text-xs text-fg-2">
                        {fmt(n.respondentsSeen ?? 0)} members, {fmt(n.answersChanged ?? 0)} answers changed,{' '}
                        {fmt(n.membersRemoved ?? 0)} removed
                        {n.capped ? ' (more to read; the next run continues)' : ''}
                      </p>
                    ) : run?.error ? (
                      <p className="text-xs text-warn">{run.error}</p>
                    ) : null}
                    {st.parkedAnswerBatches ? (
                      <p className="rounded-md bg-surface-2 px-2 py-1 text-xs text-fg-2">
                        {fmt(st.parkedAnswerBatches)} answer batch(es) waiting for their member to arrive
                      </p>
                    ) : null}
                    <SyncNowButton panel={c.panel} />
                  </div>
                );
              })()}
              <ImportButtons panel={c.panel} />
            </div>
            <details className="border-t border-border px-5 py-3 text-[12px]">
              <summary className="cursor-pointer text-fg-2">
                Audited source capabilities ({c.capabilities.filter((x) => x.status === 'verified').length}{' '}
                verified)
              </summary>
              <ul className="mt-2 space-y-1.5">
                {c.capabilities.map((cap) => (
                  <li key={cap.capability} className="flex gap-2">
                    <Badge tone={statusTone[cap.status]} className="w-16 shrink-0 justify-center">
                      {cap.status}
                    </Badge>
                    <span className="min-w-0">
                      <span className="font-mono">{cap.capability}</span>
                      <span className="block break-words text-fg-3 [overflow-wrap:anywhere]">
                        {cap.evidence}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Import & reconciliation history"
          hint="Every run records what it saw and changed"
          action={
            <DownloadMenu
              screen="connectors"
              title="Import and reconciliation history"
              columns={[
                { key: 'started', label: 'Started', type: 'date' },
                { key: 'finished', label: 'Finished', type: 'date' },
                { key: 'panel', label: 'Panel' },
                { key: 'mode', label: 'Data mode' },
                { key: 'dry', label: 'Dry run' },
                { key: 'kind', label: 'Kind' },
                { key: 'status', label: 'Status' },
                { key: 'error', label: 'Error' },
                { key: 'respondents', label: 'Respondents', type: 'number' },
                { key: 'newIds', label: 'Identities new', type: 'number' },
                { key: 'updIds', label: 'Identities updated', type: 'number' },
                { key: 'auto', label: 'Auto linked', type: 'number' },
                { key: 'review', label: 'For review', type: 'number' },
                { key: 'answers', label: 'Answers changed', type: 'number' },
                { key: 'versions', label: 'Question versions', type: 'number' },
                { key: 'dead', label: 'Dead-lettered', type: 'number' },
              ]}
              rows={jobs.map((j) => {
                const n = j.counts as Record<string, number | undefined>;
                return {
                  started: j.startedAt,
                  finished: j.finishedAt,
                  panel: j.panel.toUpperCase(),
                  mode: j.dataMode,
                  dry: j.dryRun,
                  kind: j.kind,
                  status: j.status,
                  error: j.error,
                  respondents: n.respondentsSeen,
                  newIds: n.identitiesCreated,
                  updIds: n.identitiesUpdated,
                  auto: n.autoLinked,
                  review: n.matchCandidates,
                  answers: n.answersChanged,
                  versions: n.questionVersionsCreated,
                  dead: n.deadLetteredMembers ?? 0,
                };
              })}
            />
          }
        />
        <Table
          head={[
            'Started',
            'Panel',
            'Mode',
            'Status',
            'Respondents',
            'Identities new / updated',
            'Cross-panel links',
            'Answers changed',
            'Question versions',
            'Dead-lettered',
            '',
          ]}
        >
          {jobs.map((j) => {
            const n = j.counts as Record<string, number>;
            return (
              <tr key={j.id}>
                <td className="px-5 py-2.5 whitespace-nowrap">{fmtDate(j.startedAt)}</td>
                <td className="px-5 py-2.5">
                  <PanelChip panel={j.panel} />
                </td>
                <td className="px-5 py-2.5">
                  <DataModeBadge mode={j.dataMode} /> {j.dryRun ? <Badge>dry run</Badge> : null}
                </td>
                <td className="px-5 py-2.5">
                  {j.kind === 'sync' ? <Badge>sync</Badge> : null}{' '}
                  <Badge
                    tone={j.status === 'succeeded' ? 'teal' : j.status === 'failed' ? 'danger' : 'neutral'}
                  >
                    {j.status}
                  </Badge>
                  {j.error ? <span className="ml-2 text-xs text-danger">{j.error}</span> : null}
                </td>
                <td className="num px-5 py-2.5">{fmt(n.respondentsSeen)}</td>
                <td className="num px-5 py-2.5">
                  {fmt(n.identitiesCreated)} / {fmt(n.identitiesUpdated)}
                </td>
                <td className="num whitespace-nowrap px-5 py-2.5">
                  {fmt(n.autoLinked)} auto · {fmt(n.matchCandidates)} review
                </td>
                <td className="num px-5 py-2.5">{fmt(n.answersChanged)}</td>
                <td className="num px-5 py-2.5">{fmt(n.questionVersionsCreated)}</td>
                <td className="num px-5 py-2.5">{fmt(n.deadLetteredMembers ?? 0)}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">
                  {j.kind === 'sync' ? null : (
                    <Link
                      className="text-accent underline-offset-2 hover:underline"
                      href={`/connectors/imports/${j.id}`}
                    >
                      Reconciliation
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
        {jobs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-fg-3">No imports yet.</p>
        ) : null}
      </Card>
    </>
  );
}
