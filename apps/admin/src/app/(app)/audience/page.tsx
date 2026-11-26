import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { HEALTH_ACCESS_PURPOSE_LABELS, HealthAccessPurpose, type AudienceCategory, type CountsResponse, type PanelCode } from '@madp/contracts';
import { getSegments } from '@/lib/segments';
import { api, ApiError } from '@/lib/api';
import { Country } from '@/components/country';
import type { Attribute } from '@/lib/types';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { BarList, Card, CardHeader, ChipCheck, DataModeBadge, DemoBanner, PageHeader, btn, fmt, fmtDate, input } from '@/components/ui';
import { CountUp } from '@/components/dashboard/fx';
import { PANEL_TONES } from '@/lib/panel-tones';

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
        description="Find out how many people you have: pick panels, segments and a country, then press Count people."
        actions={<DataModeBadge mode={c.dataMode} />}
      />
      <DemoBanner mode={c.dataMode} />
      <form className="mb-5 rounded-2xl border border-border/80 bg-surface p-5 shadow-soft" method="get">
        <p className="text-[15px] font-semibold text-fg">Who are you looking for?</p>
        <p className="mt-0.5 text-[13px] text-fg-3">Tick what you need. Leave a group empty to include everyone.</p>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-[12px] font-bold uppercase tracking-wider text-fg-3">1 · Panels</legend>
            <div className="flex flex-wrap gap-2">
              {panelList.map((x) => (
                <ChipCheck
                  key={x.code}
                  name="panel"
                  value={x.code}
                  label={panelName(x.code, panelList)}
                  defaultChecked={panels.includes(x.code as PanelCode)}
                  dot={PANEL_TONES[x.code]?.[1]}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-[12px] font-bold uppercase tracking-wider text-fg-3">2 · Segments</legend>
            <div className="flex flex-wrap gap-2">
              {SEG_KEYS.map((k) => (
                <ChipCheck key={k} name="category" value={k} label={SEG_LABEL[k] ?? k} defaultChecked={categories.includes(k)} />
              ))}
            </div>
          </fieldset>
          <div>
            <label className="mb-2 block text-[12px] font-bold uppercase tracking-wider text-fg-3" htmlFor="country">
              3 · Country (two-letter code)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="country"
                name="country"
                defaultValue={countries[0] ?? ''}
                placeholder="IN"
                maxLength={2}
                style={{ width: '6rem' }}
                className={`${input} uppercase`}
              />
              <ChipCheck name="verified" value="1" label="Verified e-mail only" defaultChecked={verified} />
            </div>
          </div>
        </div>
        <details className="group mt-5 rounded-xl border border-border bg-surface-2/40" open={!!attrKey || !!purpose}>
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[13px] font-semibold text-accent">
            <span className="group-open:hidden">+ More filters (profile answers)</span>
            <span className="hidden group-open:inline">− Hide profile answer filters</span>
          </summary>
          <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
            <p className="text-[12.5px] text-fg-3 sm:col-span-2">
              Pick a profile question and the answers you want. Only questions approved in the Mapping workbench are listed.
            </p>
            <select name="attr" defaultValue={attrKey} aria-label="Profile question" className={input}>
              <option value="">Any answer</option>
              {catalogue.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                  {a.sensitivity === 'special_category' ? ' (sensitive)' : ''}
                </option>
              ))}
            </select>
            <input
              name="values"
              defaultValue={attrValues.join(', ')}
              placeholder="Answers, separated by commas"
              aria-label="Answers"
              className={input}
            />
            <select name="purpose" defaultValue={purpose ?? ''} aria-label="Reason for a sensitive filter" className={`${input} sm:col-span-2`}>
              <option value="">Reason (only needed for sensitive health questions)</option>
              {HealthAccessPurpose.options.map((k) => (
                <option key={k} value={k}>
                  {HEALTH_ACCESS_PURPOSE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </details>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className={btn.primary}>
            <Search className="size-4" aria-hidden /> Count people
          </button>
          <Link href="/audience" className={btn.ghost}>
            Clear all
          </Link>
        </div>
      </form>
      {filterError ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Attribute filter not applied: {filterError}
        </p>
      ) : null}
      {resolved ? (
        <p className="mb-4 rounded-xl bg-surface-2 px-4 py-2.5 text-sm text-fg-2">
          {resolved.approvedMappings === 0
            ? `No approved mapping for ${resolved.key} yet, so no one can match. Approve mappings in the mapping workbench.`
            : `${resolved.key}: ${resolved.approvedMappings} approved mapping(s) from ${resolved.panels
                .map((p) => panelShort(p, panelList))
                .join(', ')}. Members of other panels match only through a linked identity.`}
        </p>
      ) : null}

      <div className="rise mb-4 flex flex-wrap items-center gap-5 rounded-2xl bg-gradient-to-r from-[#eef0ff] via-[#f6ecff] to-[#ffeef6] p-6 dark:from-[#141c3a] dark:via-[#1c1838] dark:to-[#2a1630]">
        <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-white shadow-lift">
          <Users className="size-7" aria-hidden />
        </span>
        <div>
          <p className="text-[13px] font-medium text-fg-2">People who match</p>
          <p className="text-[40px] font-bold leading-none text-fg">
            <CountUp value={c.uniquePeople} />
          </p>
        </div>
        <div className="ml-auto grid grid-cols-2 gap-6 text-[13px] text-fg-2">
          <div>
            <p className="text-xl font-bold text-fg">{fmt(c.panelMemberships)}</p>
            panel accounts
          </div>
          <div>
            <p className="text-xl font-bold text-fg">{fmt(c.categoryMemberships)}</p>
            segment memberships
          </div>
        </div>
        <p className="w-full text-[12.5px] text-fg-3">
          Each person counts once, even if they are in several panels. Groups smaller than {c.minimumCellSize} are hidden to protect privacy.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="By panel" />
          <BarList rows={c.byPanel.map((x) => ({ key: x.key, label: panelName(x.key, panelList), value: x.value, suppressed: x.suppressed }))} />
        </Card>
        <Card>
          <CardHeader title="By segment" hint="A person can be in several" />
          <BarList rows={c.byCategory.map((x) => ({ key: x.key, label: SEG_LABEL[x.key] ?? x.key, value: x.value, suppressed: x.suppressed }))} />
        </Card>
        <Card>
          <CardHeader
            title="By country"
            action={
              <Link href="/geo" className="text-xs font-semibold text-accent hover:underline">
                States & cities →
              </Link>
            }
          />
          <div className="max-h-96 overflow-y-auto">
            <BarList rows={c.byCountry.map((x) => ({ key: x.key, label: <Country code={x.key} />, value: x.value, suppressed: x.suppressed }))} />
          </div>
        </Card>
      </div>
      <p className="mt-4 text-xs text-fg-3">
        Minimum cell size {c.minimumCellSize} · computed {fmtDate(c.computedAt)} · freshest sync{' '}
        {fmtDate(c.freshestSourceSyncAt)}
      </p>
    </>
  );
}


