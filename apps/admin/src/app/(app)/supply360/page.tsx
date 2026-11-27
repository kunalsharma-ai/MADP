import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { type PanelCode, type SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  PanelChip,
  Table,
  fmt,
  fmtDate,
} from '@/components/ui';
import { CreateClient, RevokeClient } from './supply360-forms';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Supply360 console' };

interface ServiceClient {
  id: string;
  clientId: string;
  name: string;
  dataMode: 'demo' | 'live';
  scopes: string[];
  panels: PanelCode[];
  status: 'active' | 'revoked';
  rateLimitPerMinute: number;
  lastUsedAt: string | null;
  createdAt: string;
  activity: {
    activeReservations: number;
    membersHeld: number;
    invitations: number;
    clicked: number;
    rejectedLast7Days: number;
  };
}

export default async function Supply360Page() {
  const panelList = await getPanels();
  const [me, clients] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<ServiceClient[]>('/service-clients'),
  ]);
  const canManage = me.permissions.includes('service_clients.manage');
  return (
    <>
      <PageHeader
        eyebrow="Supply360"
        title="Supply360 console"
        description="Supply360 calls MADP as a signed service client. It gets counts, eligibility and pseudonymous references only, never names, addresses, answers or health data. MADP alone contacts members."
      />
      {canManage ? <CreateClient panels={panelList.map((x) => x.code)} /> : null}
      <Card className="mt-4">
        <CardHeader
          title="Service clients"
          hint="Each client signs every request with its own secret. A secret is shown once, when the client is created."
          action={
            <DownloadMenu
              screen="supply360"
              title="Supply360 service clients"
              columns={[
                { key: 'name', label: 'Client' },
                { key: 'clientId', label: 'Client id' },
                { key: 'mode', label: 'Data mode' },
                { key: 'panels', label: 'Panels' },
                { key: 'scopes', label: 'Scopes' },
                { key: 'status', label: 'Status' },
                { key: 'rate', label: 'Requests a minute', type: 'number' },
                { key: 'reservations', label: 'Active reservations', type: 'number' },
                { key: 'held', label: 'Members held', type: 'number' },
                { key: 'invitations', label: 'Invitations', type: 'number' },
                { key: 'clicked', label: 'Clicked', type: 'number' },
                { key: 'rejected', label: 'Refused (7 days)', type: 'number' },
                { key: 'last', label: 'Last used', type: 'date' },
                { key: 'created', label: 'Created', type: 'date' },
              ]}
              rows={clients.map((c) => ({
                name: c.name,
                clientId: c.clientId,
                mode: c.dataMode,
                panels: c.panels.map((p) => p.toUpperCase()).join(', '),
                scopes: c.scopes.join(', '),
                status: c.status,
                rate: c.rateLimitPerMinute,
                reservations: c.activity.activeReservations,
                held: c.activity.membersHeld,
                invitations: c.activity.invitations,
                clicked: c.activity.clicked,
                rejected: c.activity.rejectedLast7Days,
                last: c.lastUsedAt,
                created: c.createdAt,
              }))}
            />
          }
        />
        {clients.length === 0 ? (
          <EmptyState title="No service clients yet">Create one above to give Supply360 access.</EmptyState>
        ) : (
          <Table head={['Client', 'Panels', 'Scopes', 'Activity', 'Last used', '']}>
            {clients.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="px-5 py-3">
                  <div className="font-medium">{c.name}</div>
                  <div className="font-mono text-[12px] text-fg-3">{c.clientId}</div>
                  <div className="mt-1 flex gap-1">
                    <Badge tone={c.status === 'active' ? 'teal' : 'warn'}>{c.status}</Badge>
                    <Badge>{c.dataMode}</Badge>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.panels.map((p) => (
                      <PanelChip key={p} panel={p} />
                    ))}
                  </div>
                </td>
                <td className="px-5 py-3 text-[12px] text-fg-2">
                  {c.scopes.join(', ')}
                  <div className="text-fg-3">{fmt(c.rateLimitPerMinute)} requests a minute</div>
                </td>
                <td className="px-5 py-3 text-[12px] text-fg-2">
                  {fmt(c.activity.activeReservations)} active holds on {fmt(c.activity.membersHeld)} members
                  <br />
                  {fmt(c.activity.invitations)} invitations authorised, {fmt(c.activity.clicked)} clicked
                  <br />
                  {fmt(c.activity.rejectedLast7Days)} refused requests in 7 days
                </td>
                <td className="px-5 py-3 text-[12px] text-fg-3">
                  {c.lastUsedAt ? fmtDate(c.lastUsedAt) : 'never'}
                </td>
                <td className="px-5 py-3 text-right">
                  {canManage && c.status === 'active' ? <RevokeClient id={c.id} name={c.name} /> : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
