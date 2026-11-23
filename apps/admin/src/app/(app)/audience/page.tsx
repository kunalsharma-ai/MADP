import type { Metadata } from 'next';
import {
  AUDIENCE_CATEGORIES,
  AUDIENCE_CATEGORY_LABELS,
  PANEL_CODES,
  PANELS,
  type AudienceCategory,
  type CountsResponse,
  type PanelCode,
} from '@madp/contracts';
import { api } from '@/lib/api';
import {
  Badge,
  Card,
  CardHeader,
  DataModeBadge,
  DemoBanner,
  PageHeader,
  PanelChip,
  Stat,
  btn,
  fmt,
  fmtDate,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Audience explorer' };

type SP = Promise<Record<string, string | string[] | undefined>>;
const arr = (v: string | string[] | undefined) => (v === undefined ? [] : ([] as string[]).concat(v));

export default async function AudiencePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const panels = arr(sp.panel).filter((p): p is PanelCode => (PANEL_CODES as readonly string[]).includes(p));
  const categories = arr(sp.category).filter((c): c is AudienceCategory =>
    (AUDIENCE_CATEGORIES as readonly string[]).includes(c),
  );
  const countries = arr(sp.country)
    .map((c) => c.toLowerCase())
    .filter((c) => /^[a-z]{2}$/.test(c));
  const verified = sp.verified === '1';
  const c = await api<CountsResponse>('/audience/counts', {
    method: 'POST',
    json: { panels, categories, countries, verifiedEmailOnly: verified },
  });
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Audience explorer"
        description="Combine panels, categories and countries. Every total is de-duplicated to unique people; memberships are shown beside it."
        actions={<DataModeBadge mode={c.dataMode} />}
      />
      <DemoBanner mode={c.dataMode} />
      <form
        className="mb-5 grid gap-4 rounded-xl border border-border bg-surface p-4 lg:grid-cols-[1fr_1.6fr_1fr_auto]"
        method="get"
      >
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-fg-3">Panels</legend>
          <div className="flex flex-wrap gap-3">
            {PANEL_CODES.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  name="panel"
                  value={p}
                  defaultChecked={panels.includes(p)}
                  className="accent-[var(--accent)]"
                />{' '}
                {PANELS[p].shortName}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-fg-3">Categories</legend>
          <div className="flex flex-wrap gap-3">
            {AUDIENCE_CATEGORIES.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  name="category"
                  value={k}
                  defaultChecked={categories.includes(k)}
                  className="accent-[var(--accent)]"
                />{' '}
                {AUDIENCE_CATEGORY_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="mb-2 block text-xs font-medium text-fg-3" htmlFor="country">
            Country (ISO code)
          </label>
          <input
            id="country"
            name="country"
            defaultValue={countries[0] ?? ''}
            placeholder="e.g. in"
            maxLength={2}
            className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm uppercase"
          />
          <label className="mt-3 flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              name="verified"
              value="1"
              defaultChecked={verified}
              className="accent-[var(--accent)]"
            />{' '}
            Verified e-mail only
          </label>
        </div>
        <div className="flex items-end">
          <button className={btn.primary}>Apply</button>
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Unique people" value={fmt(c.uniquePeople)} tone="accent" />
        <Stat label="Panel memberships" value={fmt(c.panelMemberships)} />
        <Stat label="Category memberships" value={fmt(c.categoryMemberships)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Panels" />
          <ul className="divide-y divide-border text-[13px]">
            {c.byPanel.map((x) => (
              <li key={x.key} className="flex justify-between px-5 py-2.5">
                <PanelChip panel={x.key as PanelCode} />
                <Cell v={x.value} s={x.suppressed} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Categories" />
          <ul className="divide-y divide-border text-[13px]">
            {c.byCategory.map((x) => (
              <li key={x.key} className="flex justify-between px-5 py-2.5">
                <span>{AUDIENCE_CATEGORY_LABELS[x.key as AudienceCategory]}</span>
                <Cell v={x.value} s={x.suppressed} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Countries"
            hint="Drill into states and cities arrives with the country explorer (M2)"
          />
          <ul className="max-h-80 divide-y divide-border overflow-y-auto text-[13px]">
            {c.byCountry.map((x) => (
              <li key={x.key} className="flex justify-between px-5 py-2.5">
                <span className="font-mono text-xs">{x.key.toUpperCase()}</span>
                <Cell v={x.value} s={x.suppressed} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-4 text-xs text-fg-3">
        Minimum cell size {c.minimumCellSize} · computed {fmtDate(c.computedAt)} · freshest sync{' '}
        {fmtDate(c.freshestSourceSyncAt)}
      </p>
    </>
  );
}

function Cell({ v, s }: { v: number | null; s: boolean }) {
  return s ? <Badge>suppressed</Badge> : <span className="num font-medium">{fmt(v)}</span>;
}
