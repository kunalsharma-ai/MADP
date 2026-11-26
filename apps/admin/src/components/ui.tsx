import { panelShort } from '@/lib/panel-names';
import type { ReactNode } from 'react';
import {
  AUDIENCE_CATEGORY_LABELS,
  type AudienceCategory,
  type DataMode,
  type PanelCode,
} from '@madp/contracts';
import { cn } from '@/lib/cn';
import { ScreenInfo } from './screen-info';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rise rounded-xl border border-border bg-surface shadow-[0_1px_0_rgba(12,20,38,0.03)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
      <div>
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
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
      <div>
        {eyebrow ? (
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-3">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">
          {title}
          <ScreenInfo />
        </h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
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
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
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
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-fg-2">
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
      className="mb-5 flex items-start gap-3 rounded-lg border border-demo/30 bg-demo-soft px-4 py-2.5 text-[13px] text-fg"
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
    <div className="rounded-xl border border-border bg-surface px-5 py-4 rise">
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
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-sm text-fg-3">{children}</div> : null}
    </div>
  );
}

export const btn = {
  primary:
    'inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110 disabled:opacity-50',
  secondary:
    'inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface-2 disabled:opacity-50',
  ghost:
    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg',
};
export const input =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent';

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
      }).format(new Date(d))
    : '—';

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-3">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-5 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
