import type { Metadata } from 'next';
import type { DataMode, PanelCode, SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, Stat, Table, fmt, fmtDate } from '@/components/ui';
import { NewRequest, PurgeButton, RequestSteps } from './privacy-forms';

export const metadata: Metadata = { title: 'Privacy requests' };

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

const tone = (s: string) => (s === 'completed' ? 'teal' : s === 'rejected' ? 'neutral' : 'warn') as 'teal' | 'neutral' | 'warn';

export default async function PrivacyPage() {
  const [me, l, ret] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<{ dataMode: DataMode; open: number; overdue: number; awaitingPanel: number; requests: PrivacyRequest[] }>('/privacy/requests'),
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
        <Card className="px-5 py-4"><Stat label="Open" value={fmt(l.open)} /></Card>
        <Card className="px-5 py-4"><Stat label="Overdue" value={fmt(l.overdue)} /></Card>
        <Card className="px-5 py-4"><Stat label="Waiting on a panel" value={fmt(l.awaitingPanel)} /></Card>
      </div>
      {canLog ? <NewRequest /> : null}
      <Card className="mt-4">
        <CardHeader title="Requests" hint="Open requests first, by due date" />
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
                    <a className="font-mono" href={`/panellists/${r.personId}`}>{r.personId.slice(0, 8)}</a>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-1">{r.panels.map((p) => <PanelChip key={p} panel={p} />)}</div>
                </td>
                <td className="px-5 py-3"><Badge tone={tone(r.status)}>{r.status.replace('_', ' ')}</Badge></td>
                <td className="px-5 py-3 text-[12px]">
                  {fmtDate(r.dueAt)}
                  {r.overdue ? <div><Badge tone="danger">overdue</Badge></div> : null}
                </td>
                <td className="px-5 py-3 text-right">{canAct ? <RequestSteps id={r.id} kind={r.kind} status={r.status} /> : null}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader title="Retention schedule" hint="Evidence is kept. Only short-lived technical rows can be purged here." />
        <Table head={['What', 'Kept for', 'Due for removal', '']}>
          {ret.rules.map((r) => (
            <tr key={r.key}>
              <td className="px-5 py-2">{r.label}</td>
              <td className="px-5 py-2 text-[12px] text-fg-2">{r.keepDays ? `${r.keepDays} days` : r.note}</td>
              <td className="px-5 py-2">{r.eligible === null ? '—' : fmt(r.eligible)}</td>
              <td className="px-5 py-2 text-right">{canAct && r.purge ? <PurgeButton k={r.key} /> : null}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
