import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type DataMode } from '@madp/contracts';
import { getSegments } from '@/lib/segments';
import { api } from '@/lib/api';
import { Country } from '@/components/country';
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
  const segmentList = await getSegments();
  const SEG_KEYS = segmentList.map((s) => s.key);
  const SEG_LABEL: Record<string, string> = Object.fromEntries(segmentList.map((s) => [s.key, s.label]));
  const panelList = await getPanels();
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of [
    'panel',
    'category',
    'membership',
    'minor',
    'guardian',
    'country',
    'search',
    'after',
  ] as const)
    if (sp[k]) qs.set(k, sp[k]!);
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
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Panel"
        >
          <option value="">All panels</option>
          {panelList.map((x) => x.code).map((p) => (
            <option key={p} value={p}>
              {panelName(p, panelList)}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Category"
        >
          <option value="">All categories</option>
          {SEG_KEYS.map((c) => (
            <option key={c} value={c}>
              {(SEG_LABEL[c] ?? c)}
            </option>
          ))}
        </select>
        <select
          name="membership"
          defaultValue={sp.membership ?? ''}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Membership"
        >
          <option value="">Any membership</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated on the panel</option>
          <option value="deleted">Removed by the panel</option>
        </select>
        <select
          name="guardian"
          defaultValue={sp.guardian ?? ''}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Guardian consent"
        >
          <option value="">Any guardian consent</option>
          <option value="granted">Guardian approved</option>
          <option value="unknown">Guardian not decided</option>
          <option value="denied">Guardian declined</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="minor" value="true" defaultChecked={sp.minor === 'true'} />
          Teens only
        </label>
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
          <Table head={['Person', 'Panels', 'Categories', 'Guardian', 'Location', 'Born', 'E-mail']}>
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
                  <div className="flex flex-wrap gap-1">
                    {(p.memberships.length
                      ? p.memberships
                      : p.panels.map((x) => ({ panel: x, status: 'active' }))
                    ).map((m) => (
                      <span key={m.panel} className="flex items-center gap-1">
                        <PanelChip panel={m.panel} />
                        {m.status !== 'active' ? (
                          <Badge tone={m.status === 'deleted' ? 'danger' : 'warn'}>
                            {m.status === 'deleted' ? 'removed' : 'deactivated'}
                          </Badge>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {p.categories.map((c) => (
                      <CategoryChip key={c} category={c} label={SEG_LABEL[c]} />
                    ))}
                  </div>
                </td>
                <td className="px-5 py-2.5">
                  {p.minor || p.guardianConsent ? (
                    <Badge
                      tone={
                        p.guardianConsent === 'granted'
                          ? 'teal'
                          : p.guardianConsent === 'unknown' || !p.guardianConsent
                            ? 'warn'
                            : 'danger'
                      }
                    >
                      {p.guardianConsent === 'granted'
                        ? 'approved'
                        : p.guardianConsent === 'unknown' || !p.guardianConsent
                          ? 'waiting'
                          : p.guardianConsent}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-2.5">
                  {p.city || p.country ? (
                    <span className="inline-flex items-center gap-1.5">
                      {p.country ? <Country code={p.country} compact /> : null}
                      {p.city ? <span className="capitalize">{p.city}</span> : null}
                    </span>
                  ) : (
                    '—'
                  )}
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
