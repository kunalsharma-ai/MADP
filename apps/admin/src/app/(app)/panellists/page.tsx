import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AUDIENCE_CATEGORIES,
  AUDIENCE_CATEGORY_LABELS,
  PANEL_CODES,
  PANELS,
  type DataMode,
} from '@madp/contracts';
import { api } from '@/lib/api';
import type { PanellistRow } from '@/lib/types';
import {
  Badge,
  Card,
  CategoryChip,
  DataModeBadge,
  DemoBanner,
  EmptyState,
  PageHeader,
  PanelChip,
  Table,
  btn,
  input,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Panellist directory' };

export default async function PanellistsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ['panel', 'category', 'country', 'search', 'after'] as const) if (sp[k]) qs.set(k, sp[k]!);
  const data = await api<{ dataMode: DataMode; items: PanellistRow[]; nextCursor: string | null }>(
    `/panellists?${qs}`,
  );
  const next = new URLSearchParams(qs);
  if (data.nextCursor) next.set('after', data.nextCursor);
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Panellist directory"
        description="One row per unique person. Contact details are masked; opening a profile is logged."
        actions={<DataModeBadge mode={data.dataMode} />}
      />
      <DemoBanner mode={data.dataMode} />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select
          name="panel"
          defaultValue={sp.panel ?? ''}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Panel"
        >
          <option value="">All panels</option>
          {PANEL_CODES.map((p) => (
            <option key={p} value={p}>
              {PANELS[p].name}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Category"
        >
          <option value="">All categories</option>
          {AUDIENCE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {AUDIENCE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <input
          name="country"
          defaultValue={sp.country ?? ''}
          placeholder="Country (ISO)"
          maxLength={2}
          className={`${input} w-32 uppercase`}
          aria-label="Country"
        />
        <input
          name="search"
          defaultValue={sp.search ?? ''}
          placeholder="Exact e-mail, member ID or respondent ref"
          className={`${input} max-w-sm`}
          aria-label="Search"
        />
        <button className={btn.secondary}>Search</button>
      </form>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState title="No people match">
            Try fewer filters. Search matches exact values only, so partial e-mails do not match.
          </EmptyState>
        ) : (
          <Table head={['Person', 'Panels', 'Categories', 'Location', 'Born', 'E-mail']}>
            {data.items.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2/60">
                <td className="px-5 py-2.5">
                  <Link
                    className="font-mono text-xs text-accent hover:underline"
                    href={`/panellists/${p.id}`}
                  >
                    {p.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex gap-1">
                    {p.panels.map((x) => (
                      <PanelChip key={x} panel={x} />
                    ))}
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {p.categories.map((c) => (
                      <CategoryChip key={c} category={c} />
                    ))}
                  </div>
                </td>
                <td className="px-5 py-2.5 capitalize">
                  {[p.city, p.country?.toUpperCase()].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="num px-5 py-2.5">{p.birthYear ?? '—'}</td>
                <td className="px-5 py-2.5 font-mono text-xs">
                  {p.emailMasked ?? '—'} {p.emailVerified ? <Badge tone="teal">verified</Badge> : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex justify-between border-t border-border px-5 py-3 text-[13px]">
          {sp.after ? (
            <Link href="/panellists" className={btn.ghost}>
              First page
            </Link>
          ) : (
            <span />
          )}
          {data.nextCursor ? (
            <Link href={`/panellists?${next}`} className={btn.secondary}>
              Next page
            </Link>
          ) : null}
        </div>
      </Card>
    </>
  );
}
