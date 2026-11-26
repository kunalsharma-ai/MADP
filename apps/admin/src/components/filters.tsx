import Link from 'next/link';
import type { PanelInfo } from '@madp/contracts';
import { cn } from '@/lib/cn';
import { fmt } from './ui';

/** Status tabs with a count each. Every tab is a plain link that keeps the other search params. */
export function StatusTabs({
  path,
  current,
  tabs,
  params = {},
}: {
  path: string;
  current: string;
  tabs: { key: string; label: string; count?: number }[];
  params?: Record<string, string | undefined>;
}) {
  return (
    <nav aria-label="Status" className="inline-flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1 text-[13px]">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={hrefWith(path, { ...params, status: t.key })}
          aria-current={current === t.key ? 'page' : undefined}
          className={cn(
            'rounded-lg px-3.5 py-1.5 font-semibold transition',
            current === t.key ? 'bg-surface text-fg shadow-soft' : 'text-fg-2 hover:text-fg',
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">{fmt(t.count)}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/** "All panels" plus one pill per panel, as links. */
export function PanelPills({
  path,
  current,
  panels,
  params = {},
}: {
  path: string;
  current: string;
  panels: Pick<PanelInfo, 'code' | 'name'>[];
  params?: Record<string, string | undefined>;
}) {
  return (
    <nav aria-label="Panel" className="flex flex-wrap gap-1.5 text-[13px]">
      {[{ code: '', name: 'All panels' }, ...panels].map((x) => (
        <Link
          key={x.code || 'all'}
          href={hrefWith(path, { ...params, panel: x.code || undefined })}
          aria-current={current === x.code ? 'page' : undefined}
          className={cn(
            'rounded-full border px-3 py-1 font-medium transition',
            current === x.code
              ? 'border-transparent bg-gradient-to-r from-[#4f5bd5] to-[#8b5cf6] text-white'
              : 'border-border bg-surface text-fg-2 hover:border-accent/50',
          )}
        >
          {x.name}
        </Link>
      ))}
    </nav>
  );
}

function hrefWith(path: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
