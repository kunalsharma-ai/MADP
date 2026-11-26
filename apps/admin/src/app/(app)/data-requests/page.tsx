import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmtDate } from '@/components/ui';
import { ReasonAction } from '@/components/reason-action';

export const metadata: Metadata = { title: 'Data requests' };

import { DownloadMenu } from '@/components/files';

interface Req {
  id: string;
  kind: string;
  status: string;
  reason: string;
  member: { name: string; email: string; teen: boolean } | null;
  createdAt: string;
  ageDays: number;
}

export default async function DataRequestsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Data requests"
        description="Members' requests to delete their account and data. The console never deletes anything: approve once nothing stands in the way (an open reward request blocks it), carry the deletion out by the runbook, then mark it done."
      />
      {await withPanel(async () => {
        const r = await api<{ total: number; items: Req[] }>('/panel/data-requests?status=open');
        return (
          <Card>
            <CardHeader
              title={`${r.total} open`}
              action={
                <DownloadMenu
                  screen="data_requests"
                  title="Data requests (open)"
                  columns={[
                    { key: 'name', label: 'Member' },
                    { key: 'email', label: 'E-mail' },
                    { key: 'teen', label: 'Teen' },
                    { key: 'kind', label: 'Request' },
                    { key: 'reason', label: 'Reason' },
                    { key: 'status', label: 'Status' },
                    { key: 'days', label: 'Waiting (days)', type: 'number' },
                    { key: 'created', label: 'Asked', type: 'date' },
                  ]}
                  rows={r.items.map((d) => ({
                    name: d.member?.name ?? '',
                    email: d.member?.email ?? '',
                    teen: d.member?.teen ?? null,
                    kind: d.kind,
                    reason: d.reason,
                    status: d.status,
                    days: d.ageDays,
                    created: d.createdAt,
                  }))}
                />
              }
            />
            {r.items.length === 0 ? (
              <EmptyState title="No open requests" />
            ) : (
              <Table head={['Member', 'Request', 'Waiting', 'Status', '']}>
                {r.items.map((d) => (
                  <tr key={d.id}>
                    <td className="px-5 py-2.5">
                      {d.member?.name ?? '—'} {d.member?.teen ? <Badge tone="warn">Teen</Badge> : null}
                      <p className="text-[11px] text-fg-3">{d.member?.email}</p>
                    </td>
                    <td className="px-5 py-2.5 text-[12px]">
                      {d.kind}
                      {d.reason ? ` · “${d.reason}”` : ''}
                      <p className="text-fg-3">{fmtDate(d.createdAt)}</p>
                    </td>
                    <td className="num px-5 py-2.5">{d.ageDays} days</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={d.status === 'approved' ? 'teal' : 'accent'}>{d.status}</Badge>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {d.status === 'requested' ? (
                          <ReasonAction
                            op={{ op: 'data-request', id: d.id, status: 'approved' }}
                            label="Approve"
                            done="Approved"
                          />
                        ) : null}
                        {d.status === 'approved' ? (
                          <ReasonAction
                            op={{ op: 'data-request', id: d.id, status: 'done' }}
                            label="Mark done"
                            done="Marked done"
                            placeholder="What was deleted, per the runbook"
                          />
                        ) : null}
                        <ReasonAction
                          op={{ op: 'data-request', id: d.id, status: 'rejected' }}
                          label="Reject"
                          done="Rejected"
                          danger
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        );
      })}
    </>
  );
}
