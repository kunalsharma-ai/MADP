import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { HEALTH_ACCESS_PURPOSE_LABELS, HealthAccessPurpose, type AudienceCategory, type CountsResponse, type PanelCode } from '@madp/contracts';
import { getSegments } from '@/lib/segments';
import { api, ApiError } from '@/lib/api';
import { Country } from '@/components/country';
import type { Attribute } from '@/lib/types';
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
  const segmentList = await getSegments();
  const SEG_KEYS = segmentList.map((s) => s.key);
  const SEG_LABEL: Record<string, string> = Object.fromEntries(segmentList.map((s) => [s.key, s.label]));
  const panelList = await getPanels();
  const sp = await searchParams;
  const panels = arr(sp.panel).filter((p): p is PanelCode => panelList.map((x) => x.code).includes(p));
  const categories = arr(sp.category).filter((c): c is AudienceCategory =>
    SEG_KEYS.includes(c),
  );
  const countries = arr(sp.country)
    .map((c) => c.toLowerCase())
    .filter((c) => /^[a-z]{2}$/.test(c));
  const verified = sp.verified === '1';
  const attrKey = typeof sp.attr === 'string' ? sp.attr.slice(0, 100) : '';
  const attrValues = (typeof sp.values === 'string' ? sp.values : '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 50);
  const attributes = attrKey && attrValues.length ? [{ key: attrKey, values: attrValues }] : [];
  const purpose = (HealthAccessPurpose.options as readonly string[]).includes(String(sp.purpose ?? ''))
    ? (sp.purpose as string)
    : undefined;
  const { attributes: catalogue } = await api<{ attributes: Attribute[] }>('/audience/attributes');
  let c: CountsResponse;
  let filterError: string | null = null;
  try {
    c = await api<CountsResponse>('/audience/counts', {
      method: 'POST',
      json: { panels, categories, countries, verifiedEmailOnly: verified, attributes, ...(purpose ? { purpose } : {}) },
    });
  } catch (e) {
    // A special-category filter without health.sensitive.read is refused; show why and count without it.
    if (!(e instanceof ApiError) || (e.status !== 403 && e.status !== 404)) throw e;
    filterError = e.message;
    c = await api<CountsResponse>('/audience/counts', {
      method: 'POST',
      json: { panels, categories, countries, verifiedEmailOnly: verified },
    });
  }
  const resolved = c.attributeFilters?.[0];
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
            {panelList.map((x) => x.code).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  name="panel"
                  value={p}
                  defaultChecked={panels.includes(p)}
                  className="accent-[var(--accent)]"
                />{' '}
                {panelShort(p, panelList)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-fg-3">Categories</legend>
          <div className="flex flex-wrap gap-3">
            {SEG_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  name="category"
                  value={k}
                  defaultChecked={categories.includes(k)}
                  className="accent-[var(--accent)]"
                />{' '}
                {(SEG_LABEL[k] ?? k)}
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
        <fieldset className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr] lg:col-span-4">
          <legend className="mb-1 text-xs font-medium text-fg-3">
            Canonical attribute (uses approved mappings only)
          </legend>
          <select
            name="attr"
            defaultValue={attrKey}
            aria-label="Canonical attribute"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          >
            <option value="">No attribute filter</option>
            {catalogue.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
                {a.sensitivity === 'special_category' ? ' (special category)' : ''}
              </option>
            ))}
          </select>
          <input
            name="values"
            defaultValue={attrValues.join(', ')}
            placeholder="Canonical values, comma-separated (any of)"
            aria-label="Attribute values"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <select
            name="purpose"
            defaultValue={purpose ?? ''}
            aria-label="Purpose for a special-category filter"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm sm:col-span-2"
          >
            <option value="">Purpose (needed for special-category filters)</option>
            {HealthAccessPurpose.options.map((k) => (
              <option key={k} value={k}>
                {HEALTH_ACCESS_PURPOSE_LABELS[k]}
              </option>
            ))}
          </select>
        </fieldset>
      </form>
      {filterError ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Attribute filter not applied: {filterError}
        </p>
      ) : null}
      {resolved ? (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
          {resolved.approvedMappings === 0
            ? `No approved mapping for ${resolved.key} yet, so no one can match. Approve mappings in the mapping workbench.`
            : `${resolved.key}: ${resolved.approvedMappings} approved mapping(s) from ${resolved.panels
                .map((p) => panelShort(p, panelList))
                .join(', ')}. Members of other panels match only through a linked identity.`}
        </p>
      ) : null}

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
                <span>{(SEG_LABEL[x.key as AudienceCategory] ?? x.key as AudienceCategory)}</span>
                <Cell v={x.value} s={x.suppressed} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Countries"
            hint="Drill into states and cities on Geography & overlap"
          />
          <ul className="max-h-80 divide-y divide-border overflow-y-auto text-[13px]">
            {c.byCountry.map((x) => (
              <li key={x.key} className="flex justify-between px-5 py-2.5">
                <Country code={x.key} />
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
