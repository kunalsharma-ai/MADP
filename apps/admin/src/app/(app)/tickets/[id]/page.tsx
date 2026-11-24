import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, PageHeader, btn, fmtDate } from '@/components/ui';
import { TicketActions } from './ticket-actions';

export const metadata: Metadata = { title: 'Ticket' };

interface Ticket {
  id: string;
  no: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  category: string;
  from: { name: string; email: string };
  member: { id: string; segment: string } | null;
  createdAt: string;
  conversation: { id: string; type: string; by: string; name: string | null; message: string; at: string }[];
  history: { action: string; by: string; at: string }[];
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPanel(async () => {
    const t = await api<Ticket>(`/panel/tickets/${encodeURIComponent(id)}`);
    return (
      <>
        <PageHeader
          eyebrow={`Ticket ${t.no}`}
          title={t.subject || '(no subject)'}
          description={`From ${t.from.name} · ${t.from.email} · opened ${fmtDate(t.createdAt)}`}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="accent">{t.status}</Badge>
          <Badge>{t.priority}</Badge>
          {t.member ? (
            <Link href={`/members/${t.member.id}`} className={btn.ghost}>
              Member page
            </Link>
          ) : null}
          <span className="ml-auto" />
          <Link href="/tickets" className={btn.ghost}>
            All tickets
          </Link>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Conversation"
              hint="Oldest first. Internal notes are shaded and never shown to the member."
            />
            <div className="grid gap-3 px-5 py-4 text-[13px]">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 text-[11px] text-fg-3">
                  {t.from.name} · {fmtDate(t.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{t.description || '—'}</p>
              </div>
              {t.conversation.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg border p-3 ${c.type === 'note' ? 'border-warn/30 bg-warn-soft' : c.by === 'member' ? 'border-border' : 'border-accent/30 bg-accent-soft'}`}
                >
                  <p className="mb-1 text-[11px] text-fg-3">
                    {c.type === 'note'
                      ? 'Internal note'
                      : c.by === 'member'
                        ? t.from.name
                        : (c.name ?? 'Support team')}{' '}
                    · {fmtDate(c.at)}
                  </p>
                  <p className="whitespace-pre-wrap">{c.message}</p>
                </div>
              ))}
            </div>
          </Card>
          <div className="grid content-start gap-4">
            <TicketActions
              id={t.id}
              status={t.status}
              priority={t.priority}
              assignedTo={t.assignedTo ?? ''}
            />
            <Card>
              <CardHeader title="History" />
              <ul className="grid gap-1 px-5 py-4 text-[12px] text-fg-2">
                {t.history.length === 0 ? <li>No changes yet</li> : null}
                {t.history.map((h, i) => (
                  <li key={i}>
                    {fmtDate(h.at)} · {h.action}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </>
    );
  });
}
