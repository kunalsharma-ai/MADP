'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { useTheme } from 'next-themes';
import {
  Scale,
  GitCompareArrows,
  UserRoundCheck,
  Dices,
  Mail,
  Workflow,
  Coins,
  Network,
  BadgeCheck,
  FileLock2,
  Hourglass,
  ScanSearch,
  FileSpreadsheet,
  Sparkles,
  Map as MapIcon,
  Globe2,
  LayoutDashboard,
  ListTree,
  LogOut,
  Menu,
  Moon,
  PlugZap,
  Cable,
  Layers,
  Search,
  ShieldCheck,
  Sun,
  Users,
  ListChecks,
  LayoutList,
  IdCard,
  UserCog,
  Building2,
  ClipboardList,
  Gauge,
  LifeBuoy,
  MessageSquare,
  BookOpen,
  Gift,
  Flame,
  Sprout,
  FileX2,
  ToggleRight,
} from 'lucide-react';
import type { PanelInfo, SessionUser } from '@madp/contracts';
import { NAV, PLANNED } from './nav';
import { cn } from '@/lib/cn';
import { setBrand } from '@/app/super-admin-actions';
import { BrandLogo } from './brand-logo';
import { PanelsProvider } from './panels-context';

const ICONS = {
  LayoutDashboard,
  Globe2,
  Users,
  ListChecks,
  LayoutList,
  IdCard,
  ListTree,
  GitCompareArrows,
  PlugZap,
  Cable,
  Layers,
  ShieldCheck,
  Dices,
  UserRoundCheck,
  Mail,
  Workflow,
  Coins,
  Network,
  BadgeCheck,
  FileLock2,
  Hourglass,
  ScanSearch,
  FileSpreadsheet,
  Sparkles,
  Map: MapIcon,
  UserCog,
  Building2,
  ClipboardList,
  Gauge,
  LifeBuoy,
  MessageSquare,
  BookOpen,
  Gift,
  Flame,
  Sprout,
  FileX2,
  ToggleRight,
  Scale,
} as const;
/** One colour pair per screen, so every menu icon has its own tile. Picked from the menu order, stable across renders. */
const TINTS: [string, string][] = [
  ['#6366f1', '#8b5cf6'],
  ['#ec4899', '#f43f5e'],
  ['#f97316', '#f59e0b'],
  ['#10b981', '#14b8a6'],
  ['#0ea5e9', '#3b82f6'],
  ['#a855f7', '#d946ef'],
  ['#eab308', '#f97316'],
  ['#06b6d4', '#10b981'],
  ['#ef4444', '#f97316'],
  ['#3b82f6', '#6366f1'],
];
const ORDER = NAV.flatMap((g) => g.items.map((i) => i.href));
function tintFor(href: string): [string, string] {
  const i = ORDER.indexOf(href);
  return TINTS[(i < 0 ? 0 : i) % TINTS.length]!;
}

const BRAND_LABEL: Record<string, string> = {
  all: 'All brands',
  t2o: 'Turn2Opinion',
  mfr: 'MyFrequentRewards',
  mho: 'MyHealthOpinions',
};

export function Shell({
  user,
  children,
  signOut,
  brand,
  allowAll,
  panels,
}: {
  user: SessionUser;
  /** Active panels, for the brand switcher and client components (usePanels). */
  panels: PanelInfo[];
  children: ReactNode;
  signOut: () => Promise<void>;
  /** Brand picked in the switcher: t2o, mfr, mho or all. */
  brand: string;
  allowAll: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const groups = NAV.map((g) => ({
    ...g,
    // Cross-brand screens need the permission on every brand; brand-scoped screens on the picked brand.
    items: g.items.filter(
      (i) =>
        user.permissions.includes(i.permission) ||
        (i.brandScoped &&
          brand !== 'all' &&
          (user.brandPermissions[brand as 't2o'] ?? []).includes(i.permission)),
    ),
  })).filter((g) => g.items.length);
  // The longest matching link wins, so /communications/automations does not also light up /communications.
  const current = groups
    .flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
    .filter((i) => (i.href === '/' ? path === '/' : path === i.href || path.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[17rem] shrink-0 border-r border-side-border bg-side backdrop-blur-xl lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <Link href="/" className="flex items-center gap-3 px-5 pt-5 pb-6">
            <div className="relative grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-[#6366f1] via-[#a855f7] to-[#ec4899] text-[15px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(168,85,247,0.6)]">
              M
              <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-[#22c55e]" aria-hidden />
            </div>
            <div>
              <p className="text-[15px] font-bold tracking-tight text-fg">MADP</p>
              <p className="text-[11px] text-fg-3">Master Audience Data Platform</p>
            </div>
          </Link>
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-fg-3/80">
                  {g.label}
                </p>
                <ul className="space-y-0.5">
                  {g.items.map((i) => {
                    const Icon = ICONS[i.icon as keyof typeof ICONS];
                    const active = current?.href === i.href;
                    const tint = tintFor(i.href);
                    return (
                      <li key={i.href}>
                        <Link
                          href={i.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group flex items-center gap-3 rounded-xl px-2 py-1.5 text-[13px] font-medium transition',
                            active
                              ? 'bg-surface text-fg shadow-soft ring-1 ring-border'
                              : 'text-fg-2 hover:bg-surface/70 hover:text-fg',
                          )}
                        >
                          <span
                            className={cn(
                              'grid size-7 shrink-0 place-items-center rounded-lg transition duration-200 group-hover:scale-110 group-hover:-rotate-6',
                              active ? 'text-white shadow-md' : '',
                            )}
                            style={
                              active
                                ? { backgroundImage: `linear-gradient(135deg, ${tint[0]}, ${tint[1]})` }
                                : { background: `color-mix(in oklab, ${tint[0]} 14%, transparent)`, color: tint[0] }
                            }
                          >
                            <Icon className="size-[15px]" aria-hidden />
                          </span>
                          <span className="truncate">{i.label}</span>
                          {active ? (
                            <span className="ml-auto size-1.5 rounded-full" style={{ background: tint[1] }} aria-hidden />
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {PLANNED.length ? (
              <div>
                <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-fg-3/80">
                  Coming next
                </p>
                <ul className="space-y-0.5">
                  {PLANNED.map((p) => (
                    <li key={p.label} className="flex items-center justify-between px-3 py-1 text-[12px] text-fg-3">
                      {p.label}
                      <span className="rounded bg-surface-2 px-1 text-[10px]">{p.milestone}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </nav>
          <div className="m-3 flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-soft">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#f97316] to-[#ec4899] text-[13px] font-bold text-white">
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-fg">{user.displayName}</p>
              <p className="truncate text-[11px] text-fg-3">
                {user.grants
                  .map(
                    (g) =>
                      `${g.role.replaceAll('_', ' ')}${g.brands ? ` (${g.brands.join(', ').toUpperCase()})` : ''}`,
                  )
                  .join(' · ')}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border/70 bg-bg/70 px-4 backdrop-blur-xl sm:px-8">
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1 truncate text-[13px] text-fg-3">
            <Link href="/" className="hover:text-fg">
              MADP
            </Link>
            {current ? (
              <>
                <span className="mx-1.5">/</span>
                <span>{current.group}</span>
                <span className="mx-1.5">/</span>
                <span className="text-fg">{current.label}</span>
              </>
            ) : null}
          </nav>
          <label className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <span className="hidden md:inline">Brand</span>
            {brand === 't2o' || brand === 'mfr' || brand === 'mho' ? (
              <BrandLogo panel={brand} size={28} />
            ) : null}
            <select
              aria-label="Brand"
              value={brand}
              onChange={(e) => {
                const next = e.target.value;
                void setBrand(next).then(() => router.refresh());
              }}
              className="rounded-xl border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-fg shadow-soft"
            >
              {allowAll ? <option value="all">{BRAND_LABEL.all}</option> : null}
              {user.brands.map((b) => (
                <option key={b} value={b}>
                  {BRAND_LABEL[b] ?? panels.find((p) => p.code === b)?.name ?? b.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setOpen(true)}
            className="hidden items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-[13px] text-fg-3 shadow-soft transition hover:text-fg sm:flex"
            aria-label="Open command palette"
          >
            <Search className="size-3.5" aria-hidden /> Search or jump to…
            <kbd className="rounded border border-border px-1 font-mono text-[10px]">Ctrl K</kbd>
          </button>
          <button
            onClick={() => setOpen(true)}
            className="rounded-md p-2 text-fg-3 hover:bg-surface-2 hover:text-fg sm:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-4" aria-hidden />
          </button>
          <ThemeToggle />
          <form action={signOut}>
            <button
              className="rounded-md p-2 text-fg-3 hover:bg-surface-2 hover:text-fg"
              aria-label="Sign out"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-7 sm:px-8"><PanelsProvider panels={panels}>{children}</PanelsProvider></main>
      </div>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command palette"
        className="fixed inset-0 z-50 grid place-items-start bg-black/40 pt-[14vh] backdrop-blur-sm"
        contentClassName="mx-auto w-full max-w-lg"
      >
        <div className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <Command.Input
            autoFocus
            placeholder="Jump to a screen…"
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-3"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-fg-3">No match.</Command.Empty>
            {groups.map((g) => (
              <Command.Group
                key={g.label}
                heading={g.label}
                className="text-[11px] text-fg-3 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {g.items.map((i) => (
                  <Command.Item
                    key={i.href}
                    value={`${g.label} ${i.label}`}
                    onSelect={() => {
                      setOpen(false);
                      router.push(i.href);
                    }}
                    className="cursor-pointer rounded-md px-2 py-2 text-sm text-fg data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent"
                  >
                    {i.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </div>
      </Command.Dialog>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <button
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="rounded-md p-2 text-fg-3 hover:bg-surface-2 hover:text-fg"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
