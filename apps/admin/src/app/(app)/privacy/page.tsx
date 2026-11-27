import type { Metadata } from 'next';
import type { DataMode, PanelCode, SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import {
  Badge,
  Card,
  CardHeader,
  DataModeBadge,
  DemoBanner,
  EmptyState,
  PageHeader,
  PanelChip,
  Stat,
  Table,
  fmt,
  fmtDate,
} from '@/components/ui';
import { NewRequest, PurgeButton, RequestSteps } from './privacy-forms';

export const metadata: Metadata = { title: 'Privacy requests' };

import { DownloadMenu } from '@/components/files';

interface PrivacyRequest {
  id: string;
  personId: string;
  kind: string;
  panels: PanelCode[];
  status: string;
  reference: string;
  jurisdiction: string | null;
  receivedAt: string;
  dueAt: string;
  overdue: boolean;
}
interface RetentionRule {
  key: string;
  label: string;
  keepDays: number | null;
  purge: boolean;
  note?: string;
  eligible: number | null;
}

const tone = (s: string) =>
  (s === 'completed' ? 'teal' : s === 'rejected' ? 'neutral' : 'warn') as 'teal' | 'neutral' | 'warn';

export default async function PrivacyPage() {
  const [me, l, ret] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<{
      dataMode: DataMode;
      open: number;
      overdue: number;
      awaitingPanel: number;
      requests: PrivacyRequest[];
    }>('/privacy/requests'),
    api<{ rules: RetentionRule[] }>('/privacy/retention'),
  ]);
  const canLog = me.permissions.includes('privacy.request');
  const canAct = me.permissions.includes('privacy.execute');
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Privacy requests"
        description="Access, correction, deletion and restriction requests with due dates and a trail nobody can edit. The person who logs a request never verifies or carries it out. Deletion erases MADP's copy at once, keeps the member out of later syncs, and closes when the panel confirms its own deletion."
        actions={<DataModeBadge mode={l.dataMode} />}
      />
      <DemoBanner mode={l.dataMode} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Open" value={fmt(l.open)} tone="accent" />
        <Stat label="Overdue" value={fmt(l.overdue)} />
        <Stat label="Waiting on a panel" value={fmt(l.awaitingPanel)} />
      </div>
      {canLog ? <NewRequest /> : null}
      <Card className="mt-4">
        <CardHeader
          title="Requests"
          hint="Open requests first, by due date"
          action={
            <DownloadMenu
              screen="privacy"
              title="Privacy requests"
              columns={[
                { key: 'reference', label: 'Reference' },
                { key: 'kind', label: 'Request' },
                { key: 'person', label: 'Person id' },
                { key: 'panels', label: 'Panels' },
                { key: 'jurisdiction', label: 'Law' },
                { key: 'status', label: 'Status' },
                { key: 'received', label: 'Received', type: 'date' },
                { key: 'due', label: 'Due', type: 'date' },
                { key: 'overdue', label: 'Overdue' },
              ]}
              rows={l.requests.map((r) => ({
                reference: r.reference,
                kind: r.kind,
                person: r.personId,
                panels: r.panels.map((p) => p.toUpperCase()).join(', '),
                jurisdiction: r.jurisdiction,
                status: r.status.replace('_', ' '),
                received: r.receivedAt,
                due: r.dueAt,
                overdue: r.overdue,
              }))}
            />
          }
        />
        {l.requests.length === 0 ? (
          <EmptyState title="No privacy requests" />
        ) : (
          <Table head={['Request', 'Panels', 'Status', 'Due', '']}>
            {l.requests.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-5 py-3">
                  <div className="font-medium capitalize">{r.kind}</div>
                  <div className="text-[12px] text-fg-3">
                    {r.reference}
                    {r.jurisdiction ? ` · ${r.jurisdiction}` : ''} · person{' '}
                    <a className="font-mono" href={`/panellists/${r.personId}`}>
                      {r.personId.slice(0, 8)}
                    </a>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-1">
                    {r.panels.map((p) => (
                      <PanelChip key={p} panel={p} />
                    ))}
                  </div>
                </td>
                <td className="px-5 py-3">
                  <Badge tone={tone(r.status)}>{r.status.replace('_', ' ')}</Badge>
                </td>
                <td className="px-5 py-3 text-[12px]">
                  {fmtDate(r.dueAt)}
                  {r.overdue ? (
                    <div>
                      <Badge tone="danger">overdue</Badge>
                    </div>
                  ) : null}
                </td>
                <td className="px-5 py-3 text-right">
                  {canAct ? <RequestSteps id={r.id} kind={r.kind} status={r.status} /> : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader
          title="Retention schedule"
          hint="Evidence is kept. Only short-lived technical rows can be purged here."
          action={
            <DownloadMenu
              screen="privacy"
              title="Retention schedule"
              columns={[
                { key: 'what', label: 'What' },
                { key: 'kept', label: 'Kept for' },
                { key: 'due', label: 'Due for removal', type: 'number' },
                { key: 'purge', label: 'Can be purged here' },
              ]}
              rows={ret.rules.map((r) => ({
                what: r.label,
                kept: r.keepDays ? `${r.keepDays} days` : (r.note ?? ''),
                due: r.eligible,
                purge: r.purge,
              }))}
            />
          }
        />
        <Table head={['What', 'Kept for', 'Due for removal', '']}>
          {ret.rules.map((r) => (
            <tr key={r.key}>
              <td className="px-5 py-2">{r.label}</td>
              <td className="px-5 py-2 text-[12px] text-fg-2">
                {r.keepDays ? `${r.keepDays} days` : r.note}
              </td>
              <td className="px-5 py-2">{r.eligible === null ? '—' : fmt(r.eligible)}</td>
              <td className="px-5 py-2 text-right">{canAct && r.purge ? <PurgeButton k={r.key} /> : null}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
