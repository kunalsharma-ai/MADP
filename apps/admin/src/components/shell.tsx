'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { useTheme } from 'next-themes';
import {
  GitCompareArrows,
  UserRoundCheck,
  Mail,
  Workflow,
  Coins,
  Network,
  BadgeCheck,
  FileLock2,
  Hourglass,
  ScanSearch,
  Globe2,
  LayoutDashboard,
  ListTree,
  LogOut,
  Menu,
  Moon,
  PlugZap,
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
} from 'lucide-react';
import type { SessionUser } from '@madp/contracts';
import { NAV, PLANNED } from './nav';
import { cn } from '@/lib/cn';
import { setBrand } from '@/app/super-admin-actions';

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
  ShieldCheck,
  UserRoundCheck,
  Mail,
  Workflow,
  Coins,
  Network,
  BadgeCheck,
  FileLock2,
  Hourglass,
  ScanSearch,
  UserCog,
  Building2,
  ClipboardList,
  Gauge,
} as const;
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
}: {
  user: SessionUser;
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
      <aside className="hidden w-64 shrink-0 bg-nav text-nav-text lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
            <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[#2f5bea] to-[#0f9f95] text-[13px] font-bold text-white">
              M
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">MADP</p>
              <p className="text-[11px] text-nav-text/60">Master Audience Data Platform</p>
            </div>
          </div>
          <nav className="flex-1 space-y-5 overflow-y-auto px-3" aria-label="Main">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-nav-text/45">
                  {g.label}
                </p>
                <ul className="space-y-0.5">
                  {g.items.map((i) => {
                    const Icon = ICONS[i.icon as keyof typeof ICONS];
                    const active = current?.href === i.href;
                    return (
                      <li key={i.href}>
                        <Link
                          href={i.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition',
                            active ? 'bg-nav-2 text-white' : 'hover:bg-nav-2/60 hover:text-white',
                          )}
                        >
                          <Icon
                            className={cn('size-4', active ? 'text-[#7fa0ff]' : 'opacity-70')}
                            aria-hidden
                          />
                          {i.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <div>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-nav-text/45">
                Coming next
              </p>
              <ul className="space-y-0.5">
                {PLANNED.map((p) => (
                  <li
                    key={p.label}
                    className="flex items-center justify-between px-2 py-1 text-[12px] text-nav-text/45"
                  >
                    {p.label}
                    <span className="rounded bg-nav-2 px-1 text-[10px]">{p.milestone}</span>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
          <div className="border-t border-white/5 px-4 py-3">
            <p className="truncate text-[13px] text-white">{user.displayName}</p>
            <p className="truncate text-[11px] text-nav-text/60">
              {user.grants
                .map(
                  (g) =>
                    `${g.role.replaceAll('_', ' ')}${g.brands ? ` (${g.brands.join(', ').toUpperCase()})` : ''}`,
                )
                .join(' · ')}
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur sm:px-8">
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
            <select
              aria-label="Brand"
              value={brand}
              onChange={(e) => {
                const next = e.target.value;
                void setBrand(next).then(() => router.refresh());
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[13px] text-fg"
            >
              {allowAll ? <option value="all">{BRAND_LABEL.all}</option> : null}
              {user.brands.map((b) => (
                <option key={b} value={b}>
                  {BRAND_LABEL[b]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-fg-3 sm:flex"
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
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-7 sm:px-8">{children}</main>
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
