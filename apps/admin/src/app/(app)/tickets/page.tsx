import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  btn,
  fmt,
  fmtDate,
  input,
} from '@/components/ui';

import { DownloadMenu } from '@/components/files';
import { scopeText } from '@/lib/export-scope';

export const metadata: Metadata = { title: 'Ticket desk' };

interface TicketRow {
  id: string;
  no: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  from: { name: string; email: string };
  member: { id: string; segment: string } | null;
  createdAt: string;
  ageHours: number;
}
const TICKET_TONE: Record<string, 'neutral' | 'accent' | 'teal' | 'warn' | 'danger'> = {
  new: 'accent',
  open: 'accent',
  pending: 'warn',
  resolved: 'teal',
  closed: 'neutral',
};
const PRIORITY_TONE: Record<string, 'neutral' | 'warn' | 'danger'> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warn',
  urgent: 'danger',
};
const age = (h: number) => (h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`);

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set('status', sp.status ?? 'open_all');
  for (const k of ['priority', 'q', 'page'] as const) if (sp[k]) qs.set(k, sp[k]!);
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Ticket desk"
        description="Member queries for the brand picked at the top. Replies show in the member's Support and Messages pages; nothing is e-mailed while the e-mail switches are off. Internal notes are never shown to the member."
      />
      {await withPanel(async () => {
        const d = await api<{
          items: TicketRow[];
          total: number;
          counts: Record<string, number>;
          teensHidden: boolean;
        }>(`/panel/tickets?${qs}`);
        const status = qs.get('status');
        return (
          <div className="grid gap-4">
            <Card>
              <form className="flex flex-wrap items-end gap-3 px-5 py-4 text-[13px]" method="get">
                <label>
                  Status
                  <select name="status" defaultValue={status ?? ''} className={input}>
                    <option value="open_all">Not resolved</option>
                    {['new', 'open', 'pending', 'resolved', 'closed'].map((s) => (
                      <option key={s} value={s}>
                        {s} ({fmt(d.counts[s] ?? 0)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select name="priority" defaultValue={sp.priority ?? ''} className={input}>
                    <option value="">Any</option>
                    {['urgent', 'high', 'normal', 'low'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Search
                  <input
                    name="q"
                    defaultValue={sp.q}
                    className={input}
                    placeholder="Subject or ticket number"
                  />
                </label>
                <button className={btn.primary}>Filter</button>
                <Link href="/tickets" className={btn.ghost}>
                  Clear
                </Link>
              </form>
            </Card>
            <Card>
              <CardHeader
                title={`${fmt(d.total)} tickets`}
                action={
                  <DownloadMenu
                    screen="tickets"
                    title="Ticket desk"
                    subtitle={scopeText({
                      status: status ?? undefined,
                      priority: sp.priority,
                      search: sp.q,
                      page: sp.page,
                    })}
                    columns={[
                      { key: 'no', label: 'Ticket no.' },
                      { key: 'subject', label: 'Subject' },
                      { key: 'name', label: 'From' },
                      { key: 'email', label: 'E-mail' },
                      { key: 'segment', label: 'Segment' },
                      { key: 'category', label: 'Category' },
                      { key: 'priority', label: 'Priority' },
                      { key: 'status', label: 'Status' },
                      { key: 'assigned', label: 'Assigned' },
                      { key: 'age', label: 'Age (hours)', type: 'number' },
                      { key: 'opened', label: 'Opened', type: 'date' },
                    ]}
                    rows={d.items.map((t) => ({
                      no: t.no,
                      subject: t.subject,
                      name: t.from.name,
                      email: t.from.email,
                      segment: t.member?.segment ?? '',
                      category: t.category,
                      priority: t.priority,
                      status: t.status,
                      assigned: t.assignedTo ?? '',
                      age: t.ageHours,
                      opened: t.createdAt,
                    }))}
                  />
                }
                hint={
                  d.teensHidden
                    ? 'Tickets from teens are hidden: your role has no teen access on this brand.'
                    : undefined
                }
              />
              {d.items.length === 0 ? (
                <EmptyState title="No tickets here" />
              ) : (
                <Table
                  head={['Ticket', 'From', 'Segment', 'Priority', 'Status', 'Assigned', 'Age', 'Opened']}
                >
                  {d.items.map((t) => (
                    <tr key={t.id} className="hover:bg-surface-2">
                      <td className="px-5 py-2.5">
                        <Link href={`/tickets/${t.id}`} className="font-medium text-accent hover:underline">
                          {t.subject || '(no subject)'}
                        </Link>
                        <div className="font-mono text-[11px] text-fg-3">{t.no}</div>
                      </td>
                      <td className="px-5 py-2.5">
                        {t.from.name}
                        <div className="font-mono text-[11px] text-fg-3">{t.from.email}</div>
                      </td>
                      <td className="px-5 py-2.5">{t.member?.segment ?? '—'}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={PRIORITY_TONE[t.priority] ?? 'neutral'}>{t.priority}</Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={TICKET_TONE[t.status] ?? 'neutral'}>{t.status}</Badge>
                      </td>
                      <td className="px-5 py-2.5">{t.assignedTo || '—'}</td>
                      <td className="num px-5 py-2.5">{age(t.ageHours)}</td>
                      <td className="px-5 py-2.5">{fmtDate(t.createdAt)}</td>
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
