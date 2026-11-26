import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type AudienceCategory, type PanelCode, type SessionUser } from '@madp/contracts';
import { getSegments } from '@/lib/segments';
import { api } from '@/lib/api';
import type { DashboardSummary } from '@/lib/types';
import {
  ArrowRight,
  BadgeCheck,
  FileSpreadsheet,
  GitCompareArrows,
  Globe2,
  Layers,
  ListChecks,
  PlugZap,
  Sparkles,
  UserPlus,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardHeader, DataModeBadge, DemoBanner, PageHeader, fmt, fmtDate } from '@/components/ui';
import { ScreenInfo } from '@/components/screen-info';
import { BrandLogo } from '@/components/brand-logo';
import { Country } from '@/components/country';
import { CountUp, Greeting, Ring, TiltCard } from '@/components/dashboard/fx';
import { RegistrationsStudio, SegmentSwirl } from '@/components/dashboard/charts3d';
import { PANEL_TONES } from '@/lib/panel-tones';
import { SpinningGlobe } from '@/components/dashboard/globe';

export const metadata: Metadata = { title: 'Executive dashboard' };

export default async function Dashboard() {
  const segmentList = await getSegments();
  const SEG_KEYS = segmentList.map((s) => s.key);
  const SEG_LABEL: Record<string, string> = Object.fromEntries(segmentList.map((s) => [s.key, s.label]));
  const panelList = await getPanels();
  const me = await api<SessionUser>('/auth/me');
  // The executive dashboard spans every brand. Admins limited to some brands start on their brand's screens instead.
  if (!me.permissions.includes('dashboard.read')) {
    return (
      <>
        <PageHeader eyebrow="Overview" title={`Welcome, ${me.displayName}`} />
        <Card>
          <div className="px-5 py-4 text-sm text-fg-2">
            You work in {me.brands.map((b) => panelName(b, panelList)).join(', ')}. The menu on the left shows the screens your roles
            allow for the brand picked at the top. The cross-brand executive dashboard needs access to every brand.
          </div>
        </Card>
      </>
    );
  }
  const d = await api<DashboardSummary>('/dashboard/summary');
  const c = d.counts;
  const overlap = c.panelMemberships - c.uniquePeople;
  const empty = c.uniquePeople === 0;
  const verifiedPct = c.uniquePeople ? Math.round((d.kpis.verifiedPeople / c.uniquePeople) * 100) : 0;
  const panelCells = panelList.map((x, i) => {
    const cell = c.byPanel.find((y) => y.key === x.code);
    const conn = d.connectors.find((y) => y.panel === x.code);
    return { panel: x, i, cell, conn };
  });
  const topCountries = c.byCountry.slice(0, 7);
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  return (
    <>
      {/* Hero: greeting, quick actions, and a 3D orb holding the headline number. */}
      <section className="rise relative z-10 mb-6 rounded-[28px] border border-white/60 bg-gradient-to-br from-[#eef0ff] via-[#f6ecff] to-[#ffeef6] p-6 shadow-soft sm:p-8 dark:border-border dark:from-[#141c3a] dark:via-[#1c1838] dark:to-[#2a1630]">
        {/* The orbs sit in their own clipped layer, so the "i" card can open past the hero's edge. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden>
          <div className="float-a absolute -right-10 -top-16 size-64 rounded-full bg-[radial-gradient(circle_at_30%_30%,#c7d2fe,#818cf8_55%,#6366f1)] opacity-40 blur-2xl" />
          <div className="float-b absolute -bottom-20 left-1/3 size-56 rounded-full bg-[radial-gradient(circle_at_30%_30%,#fbcfe8,#f472b6_60%)] opacity-30 blur-2xl" />
        </div>
        <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">Overview · {today}</p>
            <h1 className="mt-2 flex flex-wrap items-center text-3xl font-bold tracking-tight text-fg sm:text-[34px]">
              <span>
                <Greeting name={me.displayName} />
              </span>
              <ScreenInfo />
            </h1>
            <p className="mt-2 max-w-2xl text-[15px] text-fg-2">
              Your executive dashboard. Unique people are counted once across all panels. Panel and segment memberships are
              shown separately, so nobody is double-counted.
            </p>
            <div className="mt-3">
              <DataModeBadge mode={d.dataMode} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <QuickLink href="/audience" Icon={Globe2} label="Explore audience" from="#6366f1" to="#8b5cf6" />
              <QuickLink href="/reports" Icon={FileSpreadsheet} label="Reports" from="#ec4899" to="#f43f5e" />
              <QuickLink href="/question-bank" Icon={ListChecks} label="Question bank" from="#f97316" to="#f59e0b" />
              <QuickLink href="/panel-connections" Icon={PlugZap} label="Panel connections" from="#10b981" to="#14b8a6" />
              <QuickLink href="/insights" Icon={Sparkles} label="AI insights" from="#0ea5e9" to="#3b82f6" />
            </div>
          </div>
          <div className="relative mx-auto grid size-56 place-items-center [perspective:800px]" aria-hidden>
            <div className="orbit absolute inset-0 rounded-full border-2 border-dashed border-[#a855f7]/40">
              <span className="absolute -top-1.5 left-1/2 size-3 rounded-full bg-[#ec4899] shadow-[0_0_12px_#ec4899]" />
              <span className="absolute -bottom-1.5 left-1/3 size-2.5 rounded-full bg-[#6366f1] shadow-[0_0_12px_#6366f1]" />
              <span className="absolute left-[-6px] top-1/2 size-2 rounded-full bg-[#14b8a6] shadow-[0_0_10px_#14b8a6]" />
            </div>
            <div className="spin-slow absolute inset-5 rounded-full bg-[conic-gradient(from_0deg,#6366f1,#a855f7,#ec4899,#f97316,#14b8a6,#6366f1)] opacity-90 blur-[1px]" />
            <div className="absolute inset-7 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ffffff,#eef0ff_45%,#dcd6ff)] shadow-[inset_-10px_-14px_30px_rgba(99,102,241,0.25),0_20px_40px_-12px_rgba(99,102,241,0.5)] dark:bg-[radial-gradient(circle_at_32%_28%,#2b3566,#18204a_50%,#10173a)]" />
            <div className="relative text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">Unique people</p>
              <p className="text-[40px] font-bold leading-tight text-fg">
                <CountUp value={c.uniquePeople} />
              </p>
              <p className="text-[11px] font-medium text-fg-3">across {panelList.length} panels</p>
            </div>
          </div>
        </div>
      </section>

      <DemoBanner mode={d.dataMode} />
      {empty ? (
        <Card className="mb-6 p-6 text-sm text-fg-2">
          No audience data yet. Run an import from{' '}
          <Link className="text-accent underline-offset-2 hover:underline" href="/connectors">
            Connectors &amp; sync
          </Link>
          .
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          Icon={Users}
          from="#6366f1"
          to="#8b5cf6"
          label="Unique people"
          value={c.uniquePeople}
          hint="Distinct master persons with an active membership"
          bar={1}
        />
        <Kpi
          Icon={Layers}
          from="#f97316"
          to="#f59e0b"
          label="Panel memberships"
          value={c.panelMemberships}
          hint={`${fmt(overlap)} are second or third memberships of the same person`}
          bar={c.panelMemberships ? c.uniquePeople / c.panelMemberships : 0}
        />
        <Kpi
          Icon={GitCompareArrows}
          from="#ec4899"
          to="#a855f7"
          label="Segment memberships"
          value={c.categoryMemberships}
          hint="A person can belong to several segments"
          bar={c.categoryMemberships ? Math.min(1, c.uniquePeople / c.categoryMemberships) : 0}
        />
        <Kpi
          Icon={BadgeCheck}
          from="#10b981"
          to="#14b8a6"
          label="Verified e-mail"
          value={d.kpis.verifiedPeople}
          hint={c.uniquePeople ? `${verifiedPct}% of unique people` : 'No people yet'}
          bar={verifiedPct / 100}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Registrations by month" hint="Source account creation date, per panel. Switch the view with the tabs." />
          <div className="px-4 pt-3 pb-2">
            <RegistrationsStudio rows={d.registrationsByMonth} label="Registrations per month for each panel" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Needs attention" hint="Open items, with a shortcut to each" />
          <div className="grid gap-3 p-4">
            <Action
              href="/mappings"
              Icon={ListChecks}
              from="#f97316"
              to="#f59e0b"
              label="Question mappings to review"
              value={d.kpis.pendingMappings}
              urgent={d.kpis.pendingMappings > 0}
            />
            <Action
              href="/identity"
              Icon={UserRoundCheck}
              from="#ec4899"
              to="#f43f5e"
              label="Identity matches to review"
              value={d.kpis.pendingIdentityMatches}
              urgent={d.kpis.pendingIdentityMatches > 0}
            />
            <Action
              href="/geo"
              Icon={GitCompareArrows}
              from="#6366f1"
              to="#8b5cf6"
              label="People in more than one panel"
              value={d.kpis.multiPanelPeople}
            />
            <Action
              href="/panellists"
              Icon={UserPlus}
              from="#10b981"
              to="#14b8a6"
              label="New registrations, last 30 days"
              value={d.kpis.newRegistrationsLast30Days}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="By panel" hint="Unique people per panel, and each panel's share of everyone" />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {panelCells.map(({ panel, i, cell, conn }) => {
            const [from, to] = PANEL_TONES[panel.code] ?? (['#c4b5fd', '#7c3aed'] as [string, string]);
            const v = cell?.value ?? 0;
            return (
              <TiltCard
                key={panel.code}
                className="rise flex items-center gap-4 rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-2/60 p-4"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <Ring value={v} max={c.uniquePeople} from={from} to={to} label={`${panel.name}: ${cell?.suppressed ? 'below the minimum cell' : `${v} people`}`}>
                  <div className="pop grid size-14 place-items-center rounded-full bg-surface shadow-soft">
                    <BrandLogo panel={panel.code} label={panel.shortName} size={40} />
                  </div>
                </Ring>
                <div className="pop min-w-0">
                  <p className="truncate text-[15px] font-semibold text-fg">{panelName(panel.code, panelList)}</p>
                  <p className="mt-0.5 text-2xl font-bold" style={{ color: to }}>
                    {cell?.suppressed ? <span className="text-sm text-fg-3">below minimum cell</span> : <CountUp value={v} />}
                  </p>
                  <p className="text-xs text-fg-3">
                    {cell?.suppressed || !c.uniquePeople ? '' : `${Math.round((v / c.uniquePeople) * 100)}% of unique people · `}
                    {panelShort(panel.code, panelList)}
                  </p>
                  <div className="mt-1.5">{conn ? <DataModeBadge mode={conn.dataMode} /> : null}</div>
                </div>
              </TiltCard>
            );
          })}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="By audience segment" hint="Overlapping: a person may be in several segments" />
          <div className="p-4">
            {c.byCategory.length ? (
              <SegmentSwirl
                rows={c.byCategory.map((x) => ({
                  label: SEG_LABEL[x.key as AudienceCategory] ?? x.key,
                  value: x.value,
                  suppressed: x.suppressed,
                }))}
              />
            ) : (
              <p className="px-1 py-6 text-sm text-fg-3">No data yet.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Top countries"
            hint={`Drag the globe to turn it. Cells under ${c.minimumCellSize} are suppressed.`}
            action={
              <Link href="/geo" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                Explore <ArrowRight className="size-3" aria-hidden />
              </Link>
            }
          />
          <div className="grid items-center gap-4 p-4 sm:grid-cols-[auto_1fr]">
            <SpinningGlobe values={c.byCountry} size={230} />
            <ul className="space-y-2">
              {topCountries.length ? (
                topCountries.map((x, i) => {
                  const max = Math.max(1, ...topCountries.map((y) => y.value ?? 0));
                  return (
                    <li key={x.key} className="text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <Country code={x.key} />
                        <span className="num font-semibold text-fg">{x.suppressed ? '< min' : fmt(x.value)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="grow-x h-full rounded-full bg-gradient-to-r from-[#6366f1] via-[#a855f7] to-[#ec4899]"
                          style={{ width: `${((x.value ?? 0) / max) * 100}%`, animationDelay: `${i * 80}ms` }}
                        />
                      </div>
                    </li>
                  );
                })
              ) : (
                <li className="text-sm text-fg-3">No data yet.</li>
              )}
            </ul>
          </div>
        </Card>
      </div>
      <p className="mt-5 text-xs text-fg-3">
        Computed {fmtDate(c.computedAt)} · oldest panel sync {fmtDate(c.oldestSourceSyncAt)} · questions in registry:{' '}
        {panelList.map((x) => `${panelShort(x.code, panelList)} ${fmt(d.questionsByPanel[x.code as PanelCode] ?? 0)}`).join(', ')}
      </p>
    </>
  );
}

function QuickLink({ href, Icon, label, from, to }: { href: string; Icon: LucideIcon; label: string; from: string; to: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 py-1.5 pl-1.5 pr-3.5 text-[13px] font-semibold text-fg shadow-soft backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lift dark:border-border dark:bg-surface/70"
    >
      <span
        className="grid size-7 place-items-center rounded-full text-white transition group-hover:rotate-12"
        style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      {label}
    </Link>
  );
}

function Kpi({
  Icon,
  from,
  to,
  label,
  value,
  hint,
  bar,
}: {
  Icon: LucideIcon;
  from: string;
  to: string;
  label: string;
  value: number;
  hint: string;
  bar: number;
}) {
  return (
    <TiltCard className="rise overflow-hidden rounded-2xl border border-border/80 bg-surface p-5 shadow-soft">
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-20 blur-xl"
        style={{ background: `radial-gradient(circle, ${to}, transparent 70%)` }}
        aria-hidden
      />
      <div className="pop flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-fg-3">{label}</p>
          <p className="mt-1.5 text-[32px] font-bold leading-none tracking-tight" style={{ color: to }}>
            <CountUp value={value} />
          </p>
        </div>
        <span
          className="grid size-12 shrink-0 place-items-center rounded-2xl text-white"
          style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})`, boxShadow: `0 10px 20px -8px ${to}` }}
        >
          <Icon className="size-6" aria-hidden />
        </span>
      </div>
      <div className="pop mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="grow-x h-full rounded-full"
          style={{ width: `${Math.max(4, Math.min(1, bar) * 100)}%`, backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }}
        />
      </div>
      <p className="mt-2 text-xs text-fg-3">{hint}</p>
    </TiltCard>
  );
}

function Action({
  href,
  Icon,
  from,
  to,
  label,
  value,
  urgent,
}: {
  href: string;
  Icon: LucideIcon;
  from: string;
  to: string;
  label: string;
  value: number;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-surface-2/50 p-3 transition hover:-translate-y-0.5 hover:border-transparent hover:bg-surface hover:shadow-lift"
    >
      <span
        className="relative grid size-10 shrink-0 place-items-center rounded-xl text-white transition group-hover:scale-110"
        style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        {urgent ? <span className="ping-soft absolute inset-0 rounded-xl" style={{ background: to }} aria-hidden /> : null}
        <Icon className="relative size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-[13px] font-medium text-fg">{label}</span>
      <span className="num text-lg font-bold" style={{ color: to }}>
        {fmt(value)}
      </span>
      <ArrowRight className="size-4 text-fg-3 transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
    </Link>
  );
}
