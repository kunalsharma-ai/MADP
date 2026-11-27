import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmt, fmtDate } from '@/components/ui';
import { MessageComposer, MessageRowActions } from './message-forms';

export const metadata: Metadata = { title: 'Portal messages' };

import { DownloadMenu } from '@/components/files';

interface Msg {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  cta: string;
  status: 'draft' | 'sent' | 'withdrawn';
  recipients: number;
  read: number;
  sentAt: string | null;
  createdAt: string;
}
const TONE = { draft: 'neutral', sent: 'teal', withdrawn: 'danger' } as const;

export default async function MessagesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Portal messages"
        description="Messages show in members' bell and Messages page. They are never e-mailed. Recipients are the members a filter or saved audience matches when you send; teens only get a message aimed at the teen segment, and sending one needs teen access."
      />
      {await withPanel(async () => {
        const [rows, audiences] = await Promise.all([
          api<Msg[]>('/panel/messages'),
          api<{ id: string; name: string; lastCount: number | null }[]>('/panel/audiences').catch(() => []),
        ]);
        return (
          <div className="grid gap-4">
            <MessageComposer />
            <Card>
              <CardHeader
                title={`${fmt(rows.length)} messages`}
                action={
                  <DownloadMenu
                    screen="messages"
                    title="Portal messages"
                    columns={[
                      { key: 'title', label: 'Title' },
                      { key: 'subtitle', label: 'Subtitle' },
                      { key: 'body', label: 'Message' },
                      { key: 'cta', label: 'Button' },
                      { key: 'status', label: 'Status' },
                      { key: 'recipients', label: 'Recipients', type: 'number' },
                      { key: 'read', label: 'Read', type: 'number' },
                      { key: 'sent', label: 'Sent', type: 'date' },
                      { key: 'created', label: 'Created', type: 'date' },
                    ]}
                    rows={rows.map((m) => ({
                      title: m.title,
                      subtitle: m.subtitle,
                      body: m.body,
                      cta: m.cta,
                      status: m.status,
                      recipients: m.recipients,
                      read: m.read,
                      sent: m.sentAt,
                      created: m.createdAt,
                    }))}
                  />
                }
              />
              {rows.length === 0 ? (
                <EmptyState title="No messages yet" />
              ) : (
                <Table head={['Message', 'Status', 'Recipients', 'Read', 'Sent', '']}>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{m.title}</p>
                        <p className="line-clamp-1 max-w-xl text-[12px] text-fg-3">{m.body}</p>
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={TONE[m.status]}>{m.status}</Badge>
                      </td>
                      <td className="num px-5 py-2.5">{m.status === 'draft' ? '—' : fmt(m.recipients)}</td>
                      <td className="num px-5 py-2.5">
                        {m.status === 'draft'
                          ? '—'
                          : `${fmt(m.read)} (${m.recipients ? Math.round((m.read / m.recipients) * 100) : 0}%)`}
                      </td>
                      <td className="px-5 py-2.5">{fmtDate(m.sentAt)}</td>
                      <td className="px-5 py-2.5">
                        <MessageRowActions id={m.id} status={m.status} audiences={audiences} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        );
      })}
    </>
  );
}
