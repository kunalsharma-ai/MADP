import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AUDIENCE_CATEGORIES, AUDIENCE_CATEGORY_LABELS, type AudienceCategory, type GeoResponse, type OverlapResponse, type PanelCode } from '@madp/contracts';
import { api } from '@/lib/api';
import { Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, Stat, Table, btn, fmt, fmtDate } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Country, countryName } from '@/components/country';
import { WorldMap } from './world-map';

export const metadata: Metadata = { title: 'Geography & overlap' };

type SP = Promise<Record<string, string | string[] | undefined>>;
const arr = (v: string | string[] | undefined) => (v === undefined ? [] : ([] as string[]).concat(v));
const place = (k: string) => (k === 'unknown' ? 'Not given' : k);
const n = (v: number | null) => (v === null ? <span className="text-fg-3" title="Hidden: below the minimum cell size">hidden</span> : fmt(v));

export default async function GeoPage({ searchParams }: { searchParams: SP }) {
  const panelList = await getPanels();
  const sp = await searchParams;
  const panels = arr(sp.panel).filter((p): p is PanelCode => panelList.map((x) => x.code).includes(p));
  const categories = arr(sp.category).filter((c): c is AudienceCategory => (AUDIENCE_CATEGORIES as readonly string[]).includes(c));
  const country = typeof sp.country === 'string' && /^[a-z]{2}$/i.test(sp.country) ? sp.country.toLowerCase() : undefined;
  const state = country && typeof sp.state === 'string' && sp.state.length <= 120 ? sp.state : undefined;
  const filters = { panels, categories };
  const [world, here, overlap] = await Promise.all([
    api<GeoResponse>('/audience/geo', { method: 'POST', json: filters }),
    country ? api<GeoResponse>('/audience/geo', { method: 'POST', json: { ...filters, country, state } }) : null,
    api<OverlapResponse>('/audience/overlap', {
      method: 'POST',
      json: { ...filters, ...(country ? { countries: [country] } : {}) },
    }),
  ]);
  const view = here ?? world;
  const keep = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const p of panels) q.append('panel', p);
    for (const c of categories) q.append('category', c);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `/geo?${q}`;
  };
  const mapValues = Object.fromEntries(world.rows.filter((r) => r.key !== 'unknown').map((r) => [r.key, r.uniquePeople]));
  const maxCombo = Math.max(1, ...overlap.panelCombinations.map((c) => c.people ?? 0));
  const cat = (a: string, b: string) => overlap.categoryMatrix.find((m) => m.a === a && m.b === b);
  const usedCats = AUDIENCE_CATEGORIES.filter((c) => cat(c, c));
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Geography & overlap"
        description="Unique people by country, state or province and city, and how panels and the five categories overlap. A person is counted once, at the place chosen by source precedence. Small cells are hidden."
        actions={<DataModeBadge mode={world.dataMode} />}
      />
      <DemoBanner mode={world.dataMode} />
      <form className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface px-5 py-3 text-[13px]">
        {country ? <input type="hidden" name="country" value={country} /> : null}
        {state ? <input type="hidden" name="state" value={state} /> : null}
        <fieldset className="flex items-center gap-3">
          <legend className="mb-1 text-[12px] text-fg-3">Panels</legend>
          {panelList.map((x) => x.code).map((p) => (
            <label key={p} className="flex items-center gap-1.5">
              <input type="checkbox" name="panel" value={p} defaultChecked={panels.includes(p)} />
              {panelShort(p, panelList)}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="mb-1 text-[12px] text-fg-3">Categories</legend>
          {AUDIENCE_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" name="category" value={c} defaultChecked={categories.includes(c)} />
              {AUDIENCE_CATEGORY_LABELS[c]}
            </label>
          ))}
        </fieldset>
        <button className={btn.secondary}>Apply</button>
        <span className="ml-auto text-[12px] text-fg-3">
          Computed {fmtDate(world.computedAt)} · cells under {world.minimumCellSize} hidden
        </span>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={country ? `Unique people in ${state ? place(state) : countryName(country)}` : 'Unique people'} value={fmt(view.uniquePeople)} tone="accent" />
        {panelList.map((x) => x.code).map((p) => (
          <Stat
            key={p}
            label={`${panelShort(p, panelList)} members`}
            value={n(view.rows.reduce<number | null>((a, r) => (a === null || r.byPanel[p] === null ? null : a + (r.byPanel[p] ?? 0)), 0))}
          />
        ))}
      </div>

      <Card className="mb-4">
        <CardHeader title="Where people are" hint="Darker means more unique people. Select a country to drill down." />
        <div className="px-5 py-3">
          <WorldMap values={mapValues} selected={country ?? null} hrefFor={(c) => keep({ country: c })} />
        </div>
        <ul aria-label="Countries" className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3">
          {world.rows
            .filter((r) => r.key !== 'unknown')
            .map((r) => (
              <li key={r.key}>
                <Link
                  href={keep({ country: r.key })}
                  aria-current={country === r.key ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-[12px] hover:bg-surface-2',
                    country === r.key && 'border-accent bg-accent-soft',
                  )}
                >
                  <Country code={r.key} compact />
                  <span className="font-mono text-fg-3">{n(r.uniquePeople)}</span>
                </Link>
              </li>
            ))}
        </ul>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader
            title={
              (
                <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
                  <Link className={cn(!country && 'font-semibold')} href={keep({})}>
                    World
                  </Link>
                  {country ? (
                    <>
                      <span className="text-fg-3">/</span>
                      <Link className={cn(!state && 'font-semibold')} href={keep({ country })}>
                        <Country code={country} />
                      </Link>
                    </>
                  ) : null}
                  {state ? (
                    <>
                      <span className="text-fg-3">/</span>
                      <span className="font-semibold">{place(state)}</span>
                    </>
                  ) : null}
                </nav>
              )
            }
            hint={view.level === 'country' ? 'Countries' : view.level === 'state' ? 'States and provinces' : 'Cities'}
          />
          {view.rows.length === 0 ? (
            <EmptyState title="Nobody matches these filters" />
          ) : (
            <Table head={[view.level === 'country' ? 'Country' : view.level === 'state' ? 'State or province' : 'City', 'Unique people', 'T2O', 'MFR', 'MHO']}>
              {view.rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-5 py-1.5">
                    {view.level === 'city' || r.key === 'unknown' ? (
                      view.level === 'country' ? <Country code={r.key} /> : place(r.key)
                    ) : (
                      <Link className="text-accent underline" href={view.level === 'country' ? keep({ country: r.key }) : keep({ country, state: r.key })}>
                        {view.level === 'country' ? <Country code={r.key} /> : place(r.key)}
                      </Link>
                    )}
                  </td>
                  <td className="px-5 py-1.5 font-mono text-[12px]">{n(r.uniquePeople)}</td>
                  {panelList.map((x) => x.code).map((p) => (
                    <td key={p} className="px-5 py-1.5 font-mono text-[12px]">
                      {n(r.byPanel[p] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          )}
          <p className="border-t border-border px-5 py-2 text-[12px] text-fg-3">
            Panel columns count each panel&apos;s members, so a person in two panels appears in both, but only once under unique people.
          </p>
        </Card>
        <div className="space-y-4">
          {view.timezones.length ? (
            <Card>
              <CardHeader title="Time zones" hint="As members gave them; used for quiet hours" />
              <ul className="divide-y divide-border text-[13px]">
                {view.timezones.map((z) => (
                  <li key={z.key} className="flex justify-between px-5 py-1.5">
                    <span className="font-mono text-[12px]">{z.key === 'unknown' ? 'Not given' : z.key}</span>
                    <span className="font-mono text-[12px]">{n(z.people)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Panel overlap" hint={`People by the exact panels they belong to${country ? `, in ${countryName(country)}` : ''}`} />
            <ul className="space-y-2 px-5 py-3 text-[12px]">
              {overlap.panelCombinations.map((c) => (
                <li key={c.panels.join('+')} className="grid grid-cols-[120px_1fr_44px] items-center gap-2">
                  <span className="flex flex-wrap gap-1">
                    {c.panels.map((p) => (
                      <PanelChip key={p} panel={p as PanelCode} />
                    ))}
                  </span>
                  <span className="h-2 rounded bg-surface-2">
                    <span className="block h-2 rounded bg-teal" style={{ width: `${((c.people ?? 0) / maxCombo) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono">{n(c.people)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Category overlap" hint="People in both categories, in any panel. The diagonal is everyone in the category." />
        {usedCats.length === 0 ? (
          <EmptyState title="No category memberships yet" />
        ) : (
          <Table head={['', ...usedCats.map((c) => AUDIENCE_CATEGORY_LABELS[c])]}>
            {usedCats.map((a) => (
              <tr key={a}>
                <th scope="row" className="px-5 py-1.5 text-left font-medium">
                  {AUDIENCE_CATEGORY_LABELS[a]}
                </th>
                {usedCats.map((b) => {
                  const x = cat(a, b);
                  return (
                    <td key={b} className={cn('px-5 py-1.5 font-mono text-[12px]', a === b && 'bg-accent-soft font-semibold text-accent')}>
                      {x ? n(x.people) : '0'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
