import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, btn, fmt, fmtDate } from '@/components/ui';
import { DecideButtons, ReleaseHold } from './points-actions';

export const metadata: Metadata = { title: 'Points approvals' };

interface Adjustment {
  id: string;
  member: string;
  memberName: string | null;
  points: number;
  reasonCode: string;
  note: string;
  status: 'pending' | 'applied' | 'rejected';
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}
interface Hold {
  id: string;
  member: string;
  source: string;
  reason: string;
  memberNote: string;
  expectedBy: string | null;
  createdAt: string;
}
const TONE = { pending: 'warn', applied: 'teal', rejected: 'danger' } as const;

export default async function PointsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const status = ['pending', 'applied', 'rejected', 'all'].includes(sp.status ?? '') ? sp.status! : 'pending';
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Points approvals & holds"
        description="Adjustments at or above the brand's four-eyes amount (Brands & settings, 50,000 points by default) wait here until a different admin decides them. Smaller ones apply at once. Balances are always worked out from the ledger and can't go below zero."
      />
      {await withPanel(async () => {
        const [rows, holds] = await Promise.all([
          api<Adjustment[]>(`/panel/points/approvals?status=${status}`),
          api<Hold[]>('/panel/points/holds'),
        ]);
        return (
          <div className="grid gap-4">
            <Card>
              <CardHeader
                title={`${fmt(rows.length)} ${status === 'all' ? '' : `${status} `}adjustment${rows.length === 1 ? '' : 's'}`}
                hint="You can't decide an adjustment you asked for."
              />
              <div className="flex gap-1 px-5 pt-3 text-[12px]">
                {['pending', 'applied', 'rejected', 'all'].map((k) => (
                  <Link
                    key={k}
                    href={`/points?status=${k}`}
                    className={`${btn.ghost} ${status === k ? 'bg-surface-2 text-fg' : ''}`}
                  >
                    {k}
                  </Link>
                ))}
              </div>
              {rows.length === 0 ? (
                <EmptyState title="Nothing here" />
              ) : (
                <Table head={['Member', 'Points', 'Reason', 'Note', 'Status', 'Asked', 'Decided', '']}>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="px-5 py-2.5">
                        <Link href={`/members/${a.member}`} className="text-accent hover:underline">
                          {a.memberName ?? a.member}
                        </Link>
                      </td>
                      <td className={`num px-5 py-2.5 font-medium ${a.points < 0 ? 'text-danger' : ''}`}>
                        {a.points > 0 ? '+' : ''}
                        {fmt(a.points)}
                      </td>
                      <td className="px-5 py-2.5">{a.reasonCode.replaceAll('_', ' ')}</td>
                      <td className="px-5 py-2.5">{a.note}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={TONE[a.status]}>{a.status}</Badge>
                      </td>
                      <td className="px-5 py-2.5">{fmtDate(a.createdAt)}</td>
                      <td className="px-5 py-2.5">{fmtDate(a.decidedAt)}</td>
                      <td className="px-5 py-2.5">
                        {a.status === 'pending' ? <DecideButtons id={a.id} /> : null}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader
                title={`${fmt(holds.length)} open holds`}
                hint="Points held while the quality team checks a survey or reward. Members see the note, not the reason."
              />
              {holds.length === 0 ? (
                <EmptyState title="No open holds" />
              ) : (
                <Table head={['Member', 'Source', 'Reason', 'Member sees', 'Expected by', 'Held since', '']}>
                  {holds.map((h) => (
                    <tr key={h.id}>
                      <td className="px-5 py-2.5">
                        <Link
                          href={`/members/${h.member}`}
                          className="font-mono text-[12px] text-accent hover:underline"
                        >
                          {h.member}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5">{h.source}</td>
                      <td className="px-5 py-2.5">{h.reason}</td>
                      <td className="px-5 py-2.5 text-fg-2">{h.memberNote}</td>
                      <td className="px-5 py-2.5">{fmtDate(h.expectedBy)}</td>
                      <td className="px-5 py-2.5">{fmtDate(h.createdAt)}</td>
                      <td className="px-5 py-2.5">
                        <ReleaseHold id={h.id} />
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
