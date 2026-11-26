import type { Metadata } from 'next';
import type { SwitchBoard, SwitchOverride, SwitchView } from '@madp/contracts';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, PageHeader, Table, btn, fmtDate, input } from '@/components/ui';
import { ReasonAction } from '@/components/reason-action';
import { SwitchControl } from '@/components/switch-control';
import { Toggle, ToggleLabel } from '@/components/toggle';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Feature switches' };

const GROUPS: { key: SwitchView['group']; title: string; hint: string }[] = [
  { key: 'money', title: 'Money', hint: 'Anything that turns points into value for a member.' },
  { key: 'legal', title: 'Legal', hint: 'Needs legal clearance in each country first.' },
  {
    key: 'email',
    title: 'E-mail, push and WhatsApp',
    hint: 'Anything sent to members or the team outside the portal.',
  },
];
const SEGMENTS: Record<string, string> = { consumer: 'Consumer', professional: 'Professional', teen: 'Teen' };
const FROM: Record<string, string> = {
  'segment+country': 'segment and country rule',
  segment: 'segment rule',
  country: 'country rule',
  brand: 'whole-brand setting',
  default: 'default',
  kill: 'kill switch',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const scopeName = (segment?: string | null, country?: string | null) =>
  [segment ? SEGMENTS[segment] : null, country ? cap(country) : null].filter(Boolean).join(' · ') ||
  'the whole brand';
const num = (v: number | null | undefined, unit?: string) =>
  v === null || v === undefined ? null : unit === 'x' ? `${v}×` : `${v} ${unit ?? ''}`.trim();

function Override({
  o,
  k,
  unit,
  canFlip,
}: {
  o: SwitchOverride;
  k: string;
  unit?: string;
  canFlip: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="font-medium">{scopeName(o.segment, o.country)}</span>
      <Toggle
        on={o.on}
        label={`${scopeName(o.segment, o.country)}: ${o.on ? 'on' : 'off'}`}
        size="sm"
        readOnly
      />
      <ToggleLabel on={o.on} />
      {o.on && o.value !== null ? <span className="text-fg-2">{num(o.value, unit)}</span> : null}
      {o.reason ? <span className="text-fg-3">“{o.reason}”</span> : null}
      <span className="text-fg-3">{fmtDate(o.changedAt)}</span>
      {canFlip ? (
        <ReasonAction
          op={{
            op: 'switch',
            key: k,
            on: null,
            segment: o.segment ?? undefined,
            country: o.country ?? undefined,
          }}
          label="Remove"
          done="Rule removed"
        />
      ) : null}
    </li>
  );
}

function Row({
  s,
  canFlip,
  segment,
  country,
}: {
  s: SwitchView;
  canFlip: boolean;
  segment?: string;
  country?: string;
}) {
  const scoped = Boolean(segment || country);
  const unit = s.valued?.unit;
  const overrides = s.overrides ?? [];
  // the row an action here would change: the exact scope picked, or the whole brand
  const exact = scoped
    ? overrides.find((o) => (o.segment ?? undefined) === segment && (o.country ?? undefined) === country)
    : null;
  const current = scoped ? (exact ? exact.on : s.effective) : (s.set ?? s.default);
  return (
    <>
      <tr className={overrides.length ? '' : undefined}>
        <td className="max-w-md px-5 py-2.5 align-top">
          <p className="font-medium">{s.label}</p>
          <p className="font-mono text-[11px] text-fg-3">{s.key}</p>
          {s.effect ? <p className="mt-1 text-[12px] leading-snug text-fg-2">{s.effect}</p> : null}
        </td>
        <td className="px-5 py-2.5 align-top">
          {s.effective ? <Badge tone="teal">On</Badge> : <Badge>Off</Badge>}
          {s.effective && s.value !== null && s.value !== undefined ? (
            <p className="mt-1 text-[12px] font-medium">{num(s.value, unit)}</p>
          ) : null}
          {s.from && scoped ? (
            <p className="mt-1 text-[11px] text-fg-3">by {FROM[s.from] ?? s.from}</p>
          ) : null}
        </td>
        <td className="px-5 py-2.5 align-top text-[12px] text-fg-2">
          {s.set === null ? `Default (${s.default ? 'on' : 'off'})` : s.set ? 'Set on' : 'Set off'}
          {s.valued ? (
            <p className="text-fg-3">
              {num(s.setValue ?? s.valued.default, unit)}
              {s.setValue === null || s.setValue === undefined ? ' (default)' : ''}
            </p>
          ) : null}
        </td>
        <td className="max-w-xs px-5 py-2.5 align-top text-[12px] text-fg-2">
          {s.reason ? (
            <>
              <span className="line-clamp-2">{s.reason}</span>
              <span className="text-fg-3">{fmtDate(s.changedAt)}</span>
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="px-5 py-2.5 align-top">
          {canFlip ? (
            <SwitchControl
              k={s.key}
              on={current}
              segment={segment}
              country={country}
              valued={s.valued}
              value={exact?.value ?? s.value ?? s.setValue}
              scopeLabel={scopeName(segment, country)}
            />
          ) : (
            <span className="flex items-center gap-2">
              <Toggle on={s.effective} label={s.label} readOnly />
              <ToggleLabel on={s.effective} />
            </span>
          )}
        </td>
      </tr>
      {overrides.length ? (
        <tr>
          <td colSpan={5} className="bg-surface-2/40 px-5 pb-3 pt-1">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-3">
              Narrower rules ({overrides.length})
            </p>
            <ul className="grid gap-1">
              {overrides.map((o) => (
                <Override key={`${o.segment}|${o.country}`} o={o} k={s.key} unit={unit} canFlip={canFlip} />
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default async function SwitchesPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string; country?: string }>;
}) {
  const sp = await searchParams;
  const segment = sp.segment && SEGMENTS[sp.segment] ? sp.segment : undefined;
  const country = sp.country?.trim().toLowerCase() || undefined;
  const qs = new URLSearchParams({
    ...(segment ? { segment } : {}),
    ...(country ? { country } : {}),
  }).toString();
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Feature switches"
        description="Every money, legal and e-mail feature starts off on every brand, except the streak, challenge and referral bonuses that pay today. A switch can be set for the whole brand or narrowed to a segment, a country, or both; the most specific rule wins and the kill switch beats them all. Only Super Admin can change a switch, always with a reason, and every change is in the audit log. The panel checks at the moment it acts, so a change applies within ten seconds."
      />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-[13px]" method="get" action="/switches">
        <label className="grid gap-1">
          <span className="text-fg-2">Members in segment</span>
          <select className={`${input} w-44`} name="segment" defaultValue={segment ?? ''}>
            <option value="">Every segment</option>
            {Object.entries(SEGMENTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-fg-2">Country</span>
          <input
            className={`${input} w-44`}
            name="country"
            defaultValue={country ?? ''}
            placeholder="Every country"
            maxLength={60}
          />
        </label>
        <button className={btn.secondary} type="submit">
          Show
        </button>
        {segment || country ? (
          <a className={btn.ghost} href="/switches">
            Whole brand
          </a>
        ) : null}
      </form>
      {await withPanel(async () => {
        const b = await api<SwitchBoard & { canFlip: boolean }>(`/panel/switches${qs ? `?${qs}` : ''}`);
        const scoped = Boolean(segment || country);
        return (
          <div className="grid gap-4">
            {scoped ? (
              <p className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[13px] text-accent">
                “Now” shows what members in <strong>{scopeName(segment, country)}</strong> get. Turning a
                switch on or off here saves a rule for exactly that group; the rest of the brand keeps its
                setting.
              </p>
            ) : null}
            <div className="flex justify-end">
              <DownloadMenu
                screen="switches"
                title="Feature switches"
                subtitle={`For: ${scopeName(segment, country)}${b.killed ? ' · kill switch ON (everything stopped)' : ''}`}
                columns={[
                  { key: 'group', label: 'Group' },
                  { key: 'label', label: 'Switch' },
                  { key: 'key', label: 'Key' },
                  { key: 'now', label: 'Now' },
                  { key: 'value', label: 'Value', type: 'number' },
                  { key: 'from', label: 'Decided by' },
                  { key: 'brand', label: 'Whole brand' },
                  { key: 'default', label: 'Default' },
                  { key: 'reason', label: 'Last reason' },
                  { key: 'by', label: 'Changed by' },
                  { key: 'at', label: 'Changed', type: 'date' },
                ]}
                rows={b.switches.map((s) => ({
                  group: GROUPS.find((g) => g.key === s.group)?.title ?? s.group,
                  label: s.label,
                  key: s.key,
                  now: b.killed ? 'off (kill switch)' : s.effective ? 'on' : 'off',
                  value: s.value ?? null,
                  from: s.from ?? '',
                  brand: s.set === null ? 'default' : s.set ? 'on' : 'off',
                  default: s.default ? 'on' : 'off',
                  reason: s.reason,
                  by: s.changedBy,
                  at: s.changedAt,
                }))}
              />
            </div>
            <Card>
              <CardHeader
                title={b.killed ? 'Everything is stopped on this brand' : 'Stop everything'}
                hint="The kill switch turns every switch below off at once, for every segment and country. Each switch keeps its own setting for when the kill switch is turned off again."
                action={
                  b.canFlip ? (
                    <SwitchControl
                      k="kill"
                      on={b.killed}
                      scopeLabel="the whole brand"
                      onText="Everything stopped"
                      offText="Running"
                    />
                  ) : (
                    <span className="flex items-center gap-2">
                      <Toggle on={b.killed} label="Kill switch" readOnly />
                      <ToggleLabel on={b.killed} onText="Everything stopped" offText="Running" />
                    </span>
                  )
                }
              />
            </Card>
            {!b.canFlip ? (
              <p className="text-[13px] text-fg-3">
                You can see the switches. Only Super Admin can change them.
              </p>
            ) : null}
            {GROUPS.map((g) => (
              <Card key={g.key}>
                <CardHeader title={g.title} hint={g.hint} />
                <Table head={['Switch', 'Now', 'Whole brand', 'Last reason', '']}>
                  {b.switches
                    .filter((s) => s.group === g.key)
                    .map((s) => (
                      <Row
                        key={s.key}
                        s={{ ...s, effective: b.killed ? false : s.effective }}
                        canFlip={b.canFlip}
                        segment={segment}
                        country={country}
                      />
                    ))}
                </Table>
              </Card>
            ))}
            <p className="text-[12px] text-fg-3">
              Payouts are still made by hand. There is no payout provider switch until a provider is
              connected.
            </p>
          </div>
        );
      })}
    </>
  );
}
