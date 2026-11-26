import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Country } from '@/components/country';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, btn, fmt, input } from '@/components/ui';
import { NewMembersStrip } from '@/components/new-members';
import { TopicInfo } from '@/components/screen-info';
import { ArchiveCheck } from './archive-check';
import { SortHead, sortPage, SORT_COLUMNS, type SortDir } from './sort';
import { SavedViews } from './saved-views';
import { TypeColumns } from './type-columns';
import { MemberViewParams, type MemberTypeRule, type MemberView, type SessionUser } from '@madp/contracts';
import { GENDER_TONE, STATUS_TONE, marketingLabel, tagTint, type MemberRow, type PanelCategory } from './shared';

export const metadata: Metadata = { title: 'Members' };

const day = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const FILTERS = [
  'q',
  'status',
  'segment',
  'marketing',
  'category',
  'country',
  'from',
  'to',
  'qualityMin',
  'qualityMax',
  'inactiveSince',
  'dueBefore',
  'bornFrom',
  'bornTo',
  'gender',
  'ageMin',
  'ageMax',
  'tag',
  'sort',
  'dir',
  'page',
] as const;
/** Column filters on Member, E-mail and Phone all feed the panel's one search box. */
const SEARCH_COLUMNS = ['qName', 'qEmail', 'qPhone'] as const;
const FORM = 'member-filters';

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of FILTERS) if (sp[k]) qs.set(k, sp[k]!);
  // A saved view with a rolling window ("last 7 days") turns into a sign-up date when it is opened.
  const lastDays = Number(sp.lastDays);
  if (!sp.from && Number.isInteger(lastDays) && lastDays > 0 && lastDays <= 3650)
    qs.set('from', new Date(Date.now() - lastDays * 86_400_000).toISOString().slice(0, 10));
  const viewParams = MemberViewParams.catch({}).parse(
    Object.fromEntries(
      Object.keys(MemberViewParams.shape)
        .filter((k) => sp[k])
        .map((k) => [k, sp[k]]),
    ),
  );
  const columnSearch = SEARCH_COLUMNS.map((k) => sp[k]?.trim()).find(Boolean);
  if (!sp.q && columnSearch) qs.set('q', columnSearch);
  const sortKey = SORT_COLUMNS.find((c) => c === sp.sort);
  const dir: SortDir = sp.dir === 'asc' ? 'asc' : 'desc';
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Members"
        description="Search members of the brand picked at the top. E-mail and phone are masked; full values need the PII permission and a reason, and every look-up is in the audit log. Teens show only to admins with teen access."
        actions={
          <Link href="/members/duplicates" className={btn.secondary}>
            Find duplicates
          </Link>
        }
      />
      {await withPanel(async (brand) => {
        const [data, { views }, types, me, tagList] = await Promise.all([api<{
          items: MemberRow[];
          total: number;
          page: number;
          pageSize: number;
          teensHidden: boolean;
          /** Type answers left out because they are health data and the admin has no health access. */
          typesHidden?: number;
          /** Present when the panel sorted the whole list (panel build with column sorting). */
          sort?: { by: string; dir: SortDir };
        }>(`/panel/members?${qs}`),
          api<{ views: MemberView[] }>('/member-views').catch(() => ({ views: [] as MemberView[] })),
          api<{ rules: MemberTypeRule[]; saved: boolean; sensitivePanel: boolean; categories: PanelCategory[] }>(
            '/panel/members/type-columns',
          ).catch(() => ({ rules: [] as MemberTypeRule[], saved: false, sensitivePanel: false, categories: [] as PanelCategory[] })),
          api<SessionUser>('/auth/me').catch(() => null),
          api<{ tags: { tag: string; members: number }[] }>('/member-tags').catch(() => ({ tags: [] })),
        ]);
        const categories = types.categories.filter((c) => !c.minor || !data.teensHidden);
        const segmentName = (v: string) => types.categories.find((c) => c.value === v)?.segments.join(', ') || v;
        const page = data.page;
        const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
        const wholeList = !!sortKey && data.sort?.by === sortKey;
        const items = sortKey && !wholeList ? sortPage(data.items, sortKey, dir) : data.items;
        const keep: Record<string, string> = {};
        for (const [k, v] of Object.entries(sp)) if (v && k !== 'page' && k !== 'sort' && k !== 'dir') keep[k] = v;
        const link = (p: number) => {
          const n = new URLSearchParams(qs);
          for (const k of SEARCH_COLUMNS) if (sp[k]) n.set(k, sp[k]!);
          n.set('page', String(p));
          return `/members?${n}`;
        };
        const f = (cls = '') => `${input} !px-2 !py-1 !text-[12px] font-normal normal-case tracking-normal ${cls}`;
        const head = (key: (typeof SORT_COLUMNS)[number], label: string) => (
          <SortHead key={key} col={key} label={label} active={sortKey} dir={dir} keep={keep} />
        );
        return (
          <div className="grid gap-4">
            <NewMembersStrip only={brand} />
            <SavedViews views={views} current={viewParams} searching={!!(sp.q || columnSearch)} />
            <TypeColumns
              key={JSON.stringify(types.rules)}
              rules={types.rules}
              saved={types.saved}
              categories={types.categories}
              sensitivePanel={types.sensitivePanel}
              hidden={data.typesHidden ?? 0}
              canEdit={!!me?.permissions.includes('segments.manage')}
            />
            <Card>
              <form id={FORM} className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-6" method="get">
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
                  Tag
                  <select name="tag" defaultValue={sp.tag ?? ''} className={input}>
                    <option value="">Any tag</option>
                    {tagList.tags.map((t) => (
                      <option key={t.tag} value={t.tag}>
                        {t.tag} ({fmt(t.members)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Due for 6-month check by
                  <input name="dueBefore" type="date" defaultValue={sp.dueBefore} className={input} />
                </label>
                {sp.lastDays && !sp.from ? <input type="hidden" name="lastDays" value={sp.lastDays} /> : null}
                {sortKey ? <input type="hidden" name="sort" value={sortKey} /> : null}
                {sortKey ? <input type="hidden" name="dir" value={dir} /> : null}
                <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                  <button className={btn.primary}>Search</button>
                  <Link href="/members" className={btn.ghost}>
                    Clear
                  </Link>
                  <Link href="/members?status=archived" className={btn.ghost}>
                    Archived
                  </Link>
                </div>
                <p className="text-[12px] text-fg-3 md:col-span-6">
                  Every column below has its own filter (the row under the headings) and sorts when you click its name.
                  Press Enter or Search to apply the filters.
                </p>
              </form>
            </Card>
            <Card>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-1">
                    {fmt(data.total)} members
                    <TopicInfo
                      title="Sort and filter"
                      help={{
                        why: 'Find the members you need fast, on T2O, MFR and MHO alike.',
                        where: 'The panel itself, through its admin API: the panel sorts and filters the whole list, not only the page you see.',
                        how: [
                          'Click a column name to sort by it. Click again to flip the order (the arrow shows which way).',
                          'Type or pick in the row under the headings, then press Enter or Search. Filters on several columns work together.',
                          'Clear removes every filter and sort.',
                        ],
                      }}
                    />
                  </span>
                }
                hint={
                  <>
                    {data.teensHidden
                      ? 'Teens are hidden: your role has no teen access on this brand.'
                      : `Page ${page} of ${pages}, 50 a page`}
                    {sortKey && !wholeList && pages > 1
                      ? ' · Sorted on this page only: the panel will sort the whole list once its update is live.'
                      : ''}
                  </>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/50 text-[11px] uppercase tracking-wider text-fg-3">
                      {head('name', 'Member')}
                      {head('email', 'E-mail')}
                      {head('phone', 'Phone')}
                      {head('segment', 'Segment')}
                      <th scope="col" className="px-5 py-3 font-semibold">
                        Type
                      </th>
                      {head('country', 'Country')}
                      {head('gender', 'Gender')}
                      {head('age', 'Age')}
                      {head('quality', 'Quality')}
                      {head('status', 'Status')}
                      {head('marketing', 'Marketing')}
                      {head('signedUp', 'Signed up')}
                      {head('lastActivity', 'Last activity')}
                    </tr>
                    <tr className="border-b border-border bg-surface-2/30 align-top">
                      <th className="px-3 py-2">
                        <input form={FORM} name="qName" defaultValue={sp.qName} placeholder="Name or ID" aria-label="Filter by member name or ID" className={f('min-w-28')} />
                      </th>
                      <th className="px-3 py-2">
                        <input form={FORM} name="qEmail" type="email" defaultValue={sp.qEmail} placeholder="Full e-mail" aria-label="Filter by e-mail" className={f('min-w-32')} />
                      </th>
                      <th className="px-3 py-2">
                        <input form={FORM} name="qPhone" defaultValue={sp.qPhone} placeholder="Phone" aria-label="Filter by phone" className={f('min-w-24')} />
                      </th>
                      <th className="px-3 py-2">
                        <select form={FORM} name="category" defaultValue={sp.category ?? ''} aria-label="Filter by segment" className={f('min-w-28')}>
                          <option value="">Any</option>
                          {categories.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.segments.join(', ')} ({c.value})
                            </option>
                          ))}
                          {sp.category && !categories.some((c) => c.value === sp.category) ? <option value={sp.category}>{sp.category}</option> : null}
                        </select>
                      </th>
                      <th className="px-3 py-2">
                        <span className="block min-w-28 text-[10px] font-normal normal-case tracking-normal text-fg-3">Answers from the question bank</span>
                      </th>
                      <th className="px-3 py-2">
                        <input form={FORM} name="country" defaultValue={sp.country} placeholder="us" maxLength={2} aria-label="Filter by country code" className={f('!w-16')} />
                      </th>
                      <th className="px-3 py-2">
                        <select form={FORM} name="gender" defaultValue={sp.gender ?? ''} aria-label="Filter by gender" className={f('min-w-20')}>
                          <option value="">Any</option>
                          <option value="Female">Female</option>
                          <option value="Male">Male</option>
                          <option value="Other">Other</option>
                        </select>
                      </th>
                      <th className="px-3 py-2">
                        <div className="flex gap-1">
                          <input form={FORM} name="ageMin" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={sp.ageMin} placeholder="min" aria-label="Age from (years)" className={f('!w-14')} />
                          <input form={FORM} name="ageMax" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={sp.ageMax} placeholder="max" aria-label="Age up to (years)" className={f('!w-14')} />
                        </div>
                        {sp.bornFrom ? <input form={FORM} type="hidden" name="bornFrom" value={sp.bornFrom} /> : null}
                        {sp.bornTo ? <input form={FORM} type="hidden" name="bornTo" value={sp.bornTo} /> : null}
                      </th>
                      <th className="px-3 py-2">
                        <div className="flex gap-1">
                          <input form={FORM} name="qualityMin" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={sp.qualityMin} placeholder="min" aria-label="Quality from" className={f('!w-14')} />
                          <input form={FORM} name="qualityMax" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={sp.qualityMax} placeholder="max" aria-label="Quality up to" className={f('!w-14')} />
                        </div>
                      </th>
                      <th className="px-3 py-2">
                        <select form={FORM} name="status" defaultValue={sp.status ?? ''} aria-label="Filter by status" className={f('min-w-24')}>
                          <option value="">Any</option>
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="banned">Banned</option>
                          <option value="archived">Archived</option>
                        </select>
                      </th>
                      <th className="px-3 py-2">
                        <select form={FORM} name="marketing" defaultValue={sp.marketing ?? ''} aria-label="Filter by marketing e-mails" className={f('min-w-28')}>
                          <option value="">Any</option>
                          <option value="granted">Opted in</option>
                          <option value="withdrawn">Declined or withdrawn</option>
                          <option value="unset">Never asked</option>
                        </select>
                      </th>
                      <th className="px-3 py-2">
                        <div className="grid gap-1">
                          <input form={FORM} name="from" type="date" defaultValue={sp.from} aria-label="Signed up from" className={f('min-w-32')} />
                          <input form={FORM} name="to" type="date" defaultValue={sp.to} aria-label="Signed up up to" className={f('min-w-32')} />
                        </div>
                      </th>
                      <th className="px-3 py-2">
                        <input form={FORM} name="inactiveSince" type="date" defaultValue={sp.inactiveSince} aria-label="No activity since" title="No activity since" className={f('min-w-32')} />
                        <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-fg-3">none since</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border [&>tr]:transition-colors [&>tr:hover]:bg-accent-soft/40">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={13}>
                          <EmptyState title="No members match">Change the filters or clear them.</EmptyState>
                        </td>
                      </tr>
                    ) : null}
                    {items.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-2">
                      <td className="px-5 py-2.5">
                        <Link href={`/members/${m.id}`} className="font-medium text-accent hover:underline">
                          {m.name || '(no name)'}
                        </Link>
                        <div className="font-mono text-[11px] text-fg-3">{m.memberId ?? m.id}</div>
                        {m.tags?.length ? (
                          <div className="mt-1 flex max-w-48 flex-wrap gap-1">
                            {m.tags.map((t) => (
                              <Link key={t} href={`/members?tag=${encodeURIComponent(t)}`} className="rounded-full px-1.5 py-px text-[10px] font-semibold text-white" style={{ background: tagTint(t) }}>
                                {t}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{m.email ?? '—'}</td>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{m.phone ?? '—'}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={m.segment === 'teen' ? 'accent' : 'neutral'}>
                          <span className="capitalize" title={`Panel category: ${m.category}`}>{segmentName(m.category)}</span>
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        {m.typeValues?.length ? (
                          <div className="grid min-w-44 max-w-64 gap-1">
                            {m.typeValues.map((t) => (
                              <div key={t.label} className="text-[12px] leading-tight" title={`${t.label}: ${t.values.join(', ')}`}>
                                <span className="block text-[10px] font-semibold uppercase tracking-wide text-fg-3">{t.label}</span>
                                <span className="font-medium text-fg">{t.values.join(', ')}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-fg-3">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">{m.country ? <Country code={m.country} compact /> : '—'}</td>
                      <td className="px-5 py-2.5">
                        {m.gender ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium">
                            <span className="size-2 rounded-full" style={{ background: GENDER_TONE[m.gender] }} aria-hidden />
                            {m.gender}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5" title={m.birthYear ? `Born ${m.birthYear}` : undefined}>
                        {m.age != null ? <span className="font-semibold">{m.age} yr</span> : m.birthYear ? <span className="text-fg-3">b. {m.birthYear}</span> : '—'}
                      </td>
                      <td className="num px-5 py-2.5">{m.qualityScore}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={marketingLabel(m.marketingOptIn).tone}>{marketingLabel(m.marketingOptIn).text}</Badge>
                      </td>
                      <td className="px-5 py-2.5">{day(m.signedUpAt)}</td>
                      <td className="px-5 py-2.5">{day(m.lastActivityAt)}</td>
                    </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
