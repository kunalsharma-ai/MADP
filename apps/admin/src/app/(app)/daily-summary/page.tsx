import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Coins,
  Gift,
  ListChecks,
  UserPlus,
  Users,
} from 'lucide-react';
import type { DailySummary, DailySummaryPanel } from '@madp/contracts';
import { api } from '@/lib/api';
import { getPanels } from '@/lib/panels';
import { panelName, panelShort } from '@/lib/panel-names';
import { PANEL_TONES } from '@/lib/panel-tones';
import { BrandLogo } from '@/components/brand-logo';
import { DataModeBadge, EmptyState, Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Daily summary' };

const fmtN = (n: number) => new Intl.NumberFormat('en-IN').format(n);
const shift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const longDay = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const shortDay = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const SEGMENT: Record<string, string> = {
  consumer: 'Consumer',
  b2c: 'Consumer',
  professional: 'Professional',
  b2b: 'Professional',
  teen: 'Teen',
  patient: 'Patient',
  hcp: 'Healthcare professional',
  caregiver: 'Caregiver',
  business_professional: 'Business professional',
  healthcare_professional: 'Healthcare professional',
};
const segName = (k: string) => SEGMENT[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Up or down against the day before, in words a manager reads at a glance. */
function Change({ now, before }: { now: number; before: number }) {
  if (now === before) return <span className="text-fg-3">same as the day before</span>;
  const up = now > before;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const pct = before ? Math.round((Math.abs(now - before) / before) * 100) : null;
  return (
    <span className={up ? 'text-teal' : 'text-danger'}>
      <Icon className="mr-0.5 inline size-3.5" aria-hidden />
      {up ? '+' : '−'}
      {fmtN(Math.abs(now - before))}
      {pct !== null ? ` (${pct}%)` : ''} vs the day before
    </span>
  );
}

function Tile({
  label,
  value,
  icon: Icon,
  tint,
  children,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rise rounded-2xl border border-border/80 bg-surface px-5 py-4 shadow-soft">
      <div className="flex items-center gap-2">
        <span
          className="grid size-8 place-items-center rounded-xl text-white shadow-soft"
          style={{ background: tint }}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <p className="text-xs font-medium text-fg-3">{label}</p>
      </div>
      <p className="num mt-2 text-[28px] font-semibold leading-none tracking-tight">{fmtN(value)}</p>
      {children ? <p className="mt-2 text-xs">{children}</p> : null}
    </div>
  );
}

/** Sign-up bars with a survey-complete line, 14 days, the chosen day highlighted. */
function Trend({ p, color }: { p: DailySummaryPanel; color: [string, string] }) {
  const W = 280;
  const H = 72;
  const n = p.trend.length;
  const bw = W / n;
  const max = Math.max(1, ...p.trend.map((d) => Math.max(d.signups, d.completes)));
  const y = (v: number) => H - (v / max) * (H - 6);
  const line = p.trend.map((d, i) => `${i ? 'L' : 'M'}${(i + 0.5) * bw},${y(d.completes)}`).join(' ');
  const id = `g-${p.panel}`;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H + 14}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Sign-ups and survey completes over 14 days on ${p.panel}`}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color[0]} />
            <stop offset="1" stopColor={color[1]} />
          </linearGradient>
        </defs>
        {p.trend.map((d, i) => (
          <rect
            key={d.day}
            x={i * bw + 2}
            y={y(d.signups)}
            width={bw - 4}
            height={H - y(d.signups)}
            rx={3}
            fill={`url(#${id})`}
            opacity={i === n - 1 ? 1 : 0.45}
          >
            <title>{`${shortDay(d.day)}: ${d.signups} sign-ups, ${d.completes} completes`}</title>
          </rect>
        ))}
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-fg-2" />
        <text x={0} y={H + 12} className="fill-fg-3 text-[9px]">
          {shortDay(p.trend[0]!.day)}
        </text>
        <text x={W} y={H + 12} textAnchor="end" className="fill-fg-3 text-[9px]">
          {shortDay(p.trend[n - 1]!.day)}
        </text>
      </svg>
      <figcaption className="mt-1 flex gap-3 text-[11px] text-fg-3">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: color[1] }} aria-hidden />{' '}
          sign-ups
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-fg-2" aria-hidden /> survey completes
        </span>
      </figcaption>
    </figure>
  );
}

export default async function DailySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const sp = await searchParams;
  const qs = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? `?day=${sp.day}` : '';
  const [s, panels] = await Promise.all([api<DailySummary>(`/daily-summary${qs}`), getPanels()]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: s.timeZone }).format(new Date());
  const next = shift(s.day, 1);
  const t = s.totals;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Daily summary"
        description="One day on every panel you look after: new sign-ups by segment and country, survey completes, active members, points earned and redemptions, each compared with the day before, and a 14-day trend. A day runs midnight to midnight India time. It comes from MADP's synced copy of each panel, so it is as fresh as the last sync. Counts only, nothing personal."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/daily-summary?day=${shift(s.day, -1)}`}
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm font-semibold shadow-soft hover:bg-surface-2"
        >
          <ChevronLeft className="size-4" aria-hidden /> Day before
        </Link>
        <h2 className="px-2 text-[17px] font-bold">{longDay(s.day)}</h2>
        {next <= today ? (
          <Link
            href={`/daily-summary?day=${next}`}
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm font-semibold shadow-soft hover:bg-surface-2"
          >
            {next === today ? 'Today so far' : 'Next day'} <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
        <form method="get" action="/daily-summary" className="ml-auto flex items-center gap-2 text-sm">
          <label htmlFor="day" className="text-fg-2">
            Go to
          </label>
          <input
            id="day"
            name="day"
            type="date"
            max={today}
            defaultValue={s.day}
            className="rounded-xl border border-border bg-surface px-3 py-1.5"
          />
          <button
            type="submit"
            className="rounded-xl border border-border bg-surface px-3 py-1.5 font-semibold shadow-soft hover:bg-surface-2"
          >
            Show
          </button>
        </form>
        <DataModeBadge mode={s.dataMode} />
      </div>

      {!s.panels.length ? (
        <Card>
          <EmptyState title="No panels to summarise">
            The daily summary shows panels where you can see members.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              label="New sign-ups"
              value={t.signups}
              icon={UserPlus}
              tint="linear-gradient(135deg,#6366f1,#8b5cf6)"
            >
              <Change now={t.signups} before={t.signupsBefore} />
            </Tile>
            <Tile
              label="Survey completes"
              value={t.completes}
              icon={ListChecks}
              tint="linear-gradient(135deg,#10b981,#0d9488)"
            >
              <Change now={t.completes} before={t.completesBefore} />
            </Tile>
            <Tile
              label="Members who completed a survey"
              value={t.activeMembers}
              icon={Users}
              tint="linear-gradient(135deg,#0ea5e9,#2563eb)"
            />
            <Tile
              label="Points earned from surveys"
              value={t.pointsEarned}
              icon={Coins}
              tint="linear-gradient(135deg,#f59e0b,#f97316)"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {s.panels.map((p) => {
              const tone = PANEL_TONES[p.panel] ?? ['#94a3b8', '#64748b'];
              return (
                <section
                  key={p.panel}
                  aria-label={`${panelName(p.panel, panels)} on ${s.day}`}
                  className="rise overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
                >
                  <div
                    className="flex items-center gap-2 px-5 py-3 text-white"
                    style={{ background: `linear-gradient(120deg, ${tone[0]}, ${tone[1]})` }}
                  >
                    <span className="rounded-lg bg-white/90 p-0.5">
                      <BrandLogo panel={p.panel} size={26} label={panelShort(p.panel, panels)} />
                    </span>
                    <h3 className="text-[15px] font-bold">{panelName(p.panel, panels)}</h3>
                  </div>
                  <div className="grid gap-4 p-5">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">Sign-ups</p>
                        <p className="num text-[26px] font-semibold leading-tight">{fmtN(p.signups)}</p>
                        <p className="text-[11px]">
                          <Change now={p.signups} before={p.signupsBefore} />
                        </p>
                        <p className="text-[11px] text-fg-3">7-day average {p.signupsAvg7}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">
                          Survey completes
                        </p>
                        <p className="num text-[26px] font-semibold leading-tight">{fmtN(p.completes)}</p>
                        <p className="text-[11px]">
                          <Change now={p.completes} before={p.completesBefore} />
                        </p>
                        <p className="text-[11px] text-fg-3">
                          {fmtN(p.activeMembers)} members · {fmtN(p.pointsEarned)} points
                        </p>
                      </div>
                    </div>
                    <Trend p={p} color={tone} />
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-3">
                        New sign-ups by segment
                      </p>
                      {p.bySegment.length ? (
                        <ul className="flex flex-wrap gap-1.5">
                          {p.bySegment.map((x) => (
                            <li
                              key={x.segment}
                              className="rounded-full border border-border bg-surface-2/60 px-2.5 py-0.5 text-[12px]"
                            >
                              {segName(x.segment)} <strong>{fmtN(x.n)}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12px] text-fg-3">No sign-ups this day.</p>
                      )}
                    </div>
                    {p.byCountry.length ? (
                      <div>
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-3">
                          Top countries
                        </p>
                        <p className="text-[12px] text-fg-2">
                          {p.byCountry
                            .map(
                              (c) =>
                                `${c.country === 'unknown' ? 'Unknown' : c.country.toUpperCase()} ${fmtN(c.n)}`,
                            )
                            .join(' · ')}
                        </p>
                      </div>
                    ) : null}
                    {p.redemptions ? (
                      <p className="flex items-center gap-1.5 text-[12px] text-fg-2">
                        <Gift className="size-3.5 text-warn" aria-hidden />
                        {fmtN(p.redemptions.n)} redemptions, {fmtN(p.redemptions.points)} points
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3 border-t border-border pt-3 text-[12px] font-semibold">
                      <Link
                        href="/members"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        Members <ArrowRight className="size-3" aria-hidden />
                      </Link>
                      <Link
                        href="/activity"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        Live activity <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
