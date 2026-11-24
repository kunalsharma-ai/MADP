import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Country } from '@/components/country';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, btn, fmt, input } from '@/components/ui';
import { ArchiveCheck } from './archive-check';
import { STATUS_TONE, type MemberRow } from './shared';

export const metadata: Metadata = { title: 'Members' };

const day = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const FILTERS = [
  'q',
  'status',
  'segment',
  'category',
  'country',
  'from',
  'to',
  'qualityMin',
  'qualityMax',
  'inactiveSince',
  'dueBefore',
  'page',
] as const;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of FILTERS) if (sp[k]) qs.set(k, sp[k]!);
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Members"
        description="Search members of the brand picked at the top. E-mail and phone are masked; full values need the PII permission and a reason, and every look-up is in the audit log. Teens show only to admins with teen access."
      />
      {await withPanel(async () => {
        const data = await api<{
          items: MemberRow[];
          total: number;
          page: number;
          pageSize: number;
          teensHidden: boolean;
        }>(`/panel/members?${qs}`);
        const page = data.page;
        const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
        const link = (p: number) => {
          const n = new URLSearchParams(qs);
          n.set('page', String(p));
          return `/members?${n}`;
        };
        return (
          <div className="grid gap-4">
            <Card>
              <form className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-6" method="get">
                <label className="md:col-span-2">
                  Search
                  <input
                    name="q"
                    defaultValue={sp.q}
                    placeholder="E-mail, phone, member ID or name"
                    className={input}
                  />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={sp.status ?? ''} className={input}>
                    <option value="">Any</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="banned">Banned</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label>
                  Segment
                  <select name="category" defaultValue={sp.category ?? ''} className={input}>
                    <option value="">Any</option>
                    <option value="b2c">Consumer (b2c)</option>
                    <option value="b2b">Business Professional (b2b)</option>
                    {!data.teensHidden ? <option value="b2c-minor">Teen (b2c-minor)</option> : null}
                  </select>
                </label>
                <label>
                  Country
                  <input
                    name="country"
                    defaultValue={sp.country}
                    placeholder="us"
                    maxLength={2}
                    className={input}
                  />
                </label>
                <label>
                  Quality from
                  <input
                    name="qualityMin"
                    type="number"
                    min={0}
                    max={200}
                    defaultValue={sp.qualityMin}
                    className={input}
                  />
                </label>
                <label>
                  Signed up from
                  <input name="from" type="date" defaultValue={sp.from} className={input} />
                </label>
                <label>
                  Signed up to
                  <input name="to" type="date" defaultValue={sp.to} className={input} />
                </label>
                <label>
                  No activity since
                  <input name="inactiveSince" type="date" defaultValue={sp.inactiveSince} className={input} />
                </label>
                <label>
                  Due for 6-month check by
                  <input name="dueBefore" type="date" defaultValue={sp.dueBefore} className={input} />
                </label>
                <div className="flex items-end gap-2 md:col-span-2">
                  <button className={btn.primary}>Search</button>
                  <Link href="/members" className={btn.ghost}>
                    Clear
                  </Link>
                  <Link href="/members?status=archived" className={btn.ghost}>
                    Archived
                  </Link>
                </div>
              </form>
            </Card>
            <Card>
              <CardHeader
                title={`${fmt(data.total)} members`}
                hint={
                  data.teensHidden
                    ? 'Teens are hidden: your role has no teen access on this brand.'
                    : `Page ${page} of ${pages}, 50 a page`
                }
              />
              {data.items.length === 0 ? (
                <EmptyState title="No members match">Change the filters or clear them.</EmptyState>
              ) : (
                <Table
                  head={[
                    'Member',
                    'E-mail',
                    'Phone',
                    'Segment',
                    'Country',
                    'Born',
                    'Quality',
                    'Status',
                    'Signed up',
                    'Last activity',
                  ]}
                >
                  {data.items.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-2">
                      <td className="px-5 py-2.5">
                        <Link href={`/members/${m.id}`} className="font-medium text-accent hover:underline">
                          {m.name || '(no name)'}
                        </Link>
                        <div className="font-mono text-[11px] text-fg-3">{m.memberId ?? m.id}</div>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{m.email ?? '—'}</td>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{m.phone ?? '—'}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={m.segment === 'teen' ? 'accent' : 'neutral'}>{m.category}</Badge>
                      </td>
                      <td className="px-5 py-2.5">{m.country ? <Country code={m.country} compact /> : '—'}</td>
                      <td className="px-5 py-2.5">{m.birthYear ?? '—'}</td>
                      <td className="num px-5 py-2.5">{m.qualityScore}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                      </td>
                      <td className="px-5 py-2.5">{day(m.signedUpAt)}</td>
                      <td className="px-5 py-2.5">{day(m.lastActivityAt)}</td>
                    </tr>
                  ))}
                </Table>
              )}
              {pages > 1 ? (
                <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                  {page > 1 ? (
                    <Link href={link(page - 1)} className={btn.secondary}>
                      Previous
                    </Link>
                  ) : null}
                  {page < pages ? (
                    <Link href={link(page + 1)} className={btn.secondary}>
                      Next
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </Card>
            <ArchiveCheck />
          </div>
        );
      })}
    </>
  );
}
