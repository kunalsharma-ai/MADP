import { panelShort } from '@/lib/panel-names';
import type { ReactNode } from 'react';
import {
  AUDIENCE_CATEGORY_LABELS,
  type AudienceCategory,
  type DataMode,
  type PanelCode,
} from '@madp/contracts';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ScreenInfo } from './screen-info';
import { ScreenIcon, ShortDescription } from './page-header-parts';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rise rounded-2xl border border-border/80 bg-surface shadow-soft',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-fg-3">{hint}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-4">
        <ScreenIcon />
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
          ) : null}
          <h1 className="mt-1 flex items-center text-[26px] font-bold tracking-tight text-fg">
            {title}
            <ScreenInfo />
          </h1>
          {description ? <ShortDescription>{description}</ShortDescription> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type Tone = 'neutral' | 'accent' | 'teal' | 'warn' | 'danger' | 'demo';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-2',
  accent: 'bg-accent-soft text-accent',
  teal: 'bg-teal-soft text-teal',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  demo: 'bg-demo-soft text-demo',
};
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PanelChip({ panel, label }: { panel: PanelCode; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-fg-2">
      <span
        className="size-1.5 rounded-full"
        style={{ background: `var(--panel-${panel}, var(--text-3))` }}
        aria-hidden
      />
      {label ?? panelShort(panel)}
    </span>
  );
}

export function CategoryChip({ category, label }: { category: AudienceCategory; label?: string }) {
  return <Badge tone="neutral">{label ?? AUDIENCE_CATEGORY_LABELS[category] ?? category}</Badge>;
}

export function DataModeBadge({ mode }: { mode: DataMode }) {
  return mode === 'demo' ? <Badge tone="demo">DEMO data</Badge> : <Badge tone="teal">Live data</Badge>;
}

/** Shown on every screen that renders panel data while it comes from DEMO fixtures. */
export function DemoBanner({ mode }: { mode: DataMode }) {
  if (mode !== 'demo') return null;
  return (
    <div
      role="note"
      className="mb-5 flex items-start gap-3 rounded-2xl border border-demo/30 bg-demo-soft px-4 py-2.5 text-[13px] text-fg"
    >
      <Badge tone="demo">DEMO</Badge>
      <p>
        Counts and people on this screen are <strong>synthetic fixtures</strong>, not panel data. Question
        definitions for T2O and MHO come from their repository exports; MFR questions are placeholders. Live
        data appears only after read-only access to each panel is approved.
      </p>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'accent' | 'teal';
}) {
  return (
    <div className="rise rounded-2xl border border-border/80 bg-surface px-5 py-4 shadow-soft">
      <p className="text-xs font-medium text-fg-3">{label}</p>
      <p
        className={cn(
          'num mt-1.5 text-[28px] font-semibold leading-none tracking-tight',
          tone === 'accent' ? 'text-accent' : tone === 'teal' ? 'text-teal' : 'text-fg',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-[#e0e7ff] to-[#fce7f3] text-[#8b5cf6] dark:from-[#1e2550] dark:to-[#3a1a35]" aria-hidden>
        <Sparkles className="size-6" />
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-sm text-fg-3">{children}</div> : null}
    </div>
  );
}

export const btn = {
  primary:
    'inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#4f5bd5] to-[#8b5cf6] px-3.5 py-2 text-sm font-medium text-white shadow-[0_6px_16px_-8px_rgba(99,102,241,0.8)] transition hover:-translate-y-px hover:brightness-110 disabled:opacity-50',
  secondary:
    'inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-fg shadow-soft transition hover:-translate-y-px hover:bg-surface-2 disabled:opacity-50',
  ghost:
    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg',
};
export const input =
  'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-3 transition focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)]';

export const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN').format(n);
export const fmtDate = (d: string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
        .format(new Date(d))
        // non-breaking spaces, so a date never wraps over several lines in a narrow column
        .replaceAll(' ', '\u00a0')
    : '—';

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-[11px] uppercase tracking-wider text-fg-3">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-5 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&>tr]:transition-colors [&>tr:hover]:bg-accent-soft/40">{children}</tbody>
      </table>
    </div>
  );
}

/** Page links under a long list. params are the current search params; only "page" changes. */
export function Pager({
  total,
  page,
  size,
  path,
  params,
}: {
  total: number;
  page: number;
  size: number;
  path: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const href = (n: number) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1] && e[0] !== 'page'));
    if (n > 1) q.set('page', String(n));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const near = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const cell = 'grid h-9 min-w-9 place-items-center rounded-xl px-3 text-[13px] font-semibold transition';
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
      <p className="text-[13px] text-fg-3">
        Showing {fmt((page - 1) * size + 1)}–{fmt(Math.min(total, page * size))} of {fmt(total)}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <a href={href(page - 1)} className={cn(cell, 'border border-border bg-surface hover:bg-surface-2')}>
            Previous
          </a>
        ) : null}
        {near.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            {i > 0 && n - near[i - 1]! > 1 ? <span className="px-1 text-fg-3">…</span> : null}
            <a
              href={href(n)}
              aria-current={n === page ? 'page' : undefined}
              className={cn(
                cell,
                n === page
                  ? 'bg-gradient-to-r from-[#4f5bd5] to-[#8b5cf6] text-white shadow-soft'
                  : 'border border-border bg-surface hover:bg-surface-2',
              )}
            >
              {n}
            </a>
          </span>
        ))}
        {page < pages ? (
          <a href={href(page + 1)} className={cn(cell, 'border border-border bg-surface hover:bg-surface-2')}>
            Next
          </a>
        ) : null}
      </div>
    </nav>
  );
}
