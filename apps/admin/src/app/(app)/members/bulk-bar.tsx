'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, FileText, Layers, ListChecks, Tag, Tags, X } from 'lucide-react';
import { memberBulkAction } from '@/app/member-views-actions';
import { TopicInfo } from '@/components/screen-info';
import type { PanelCategory } from './shared';

const BOX = 'input[data-bulk-member]';
type Mode = null | 'tag_add' | 'tag_remove' | 'segment' | 'export';

/** The ticked member ids in the table (checkboxes are plain inputs in the server-rendered rows). */
const picked = () => [...document.querySelectorAll<HTMLInputElement>(`${BOX}:checked`)].map((b) => b.value);

/**
 * The bar above the Members table: tick rows, then add or remove a tag, change segment, or download the ticked rows
 * or the whole filtered list as Excel or CSV. Every action asks for a reason, which goes to the audit log.
 */
export function BulkBar({
  filters,
  categories,
  tags,
  canEdit,
  canSegment,
  canExport,
  total,
}: {
  filters: Record<string, string>;
  categories: PanelCategory[];
  tags: string[];
  canEdit: boolean;
  canSegment: boolean;
  canExport: boolean;
  total: number;
}) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [mode, setMode] = useState<Mode>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<'ticked' | 'all'>('ticked');
  const [pending, start] = useTransition();

  useEffect(() => {
    const sync = () => setCount(picked().length);
    const all = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.matches?.('input[data-bulk-all]')) document.querySelectorAll<HTMLInputElement>(BOX).forEach((b) => (b.checked = t.checked));
      sync();
    };
    document.addEventListener('change', all);
    sync();
    return () => document.removeEventListener('change', all);
  }, []);

  const clear = () => {
    document.querySelectorAll<HTMLInputElement>(`${BOX}, input[data-bulk-all]`).forEach((b) => (b.checked = false));
    setCount(0);
  };
  const open = (m: Mode) => {
    setMode(m);
    setValue(m === 'segment' ? (categories[0]?.value ?? '') : '');
    setScope(count ? 'ticked' : 'all');
  };
  const okReason = reason.trim().length >= 5;

  const run = () =>
    start(async () => {
      if (mode === 'export') {
        const format = value === 'csv' ? 'csv' : 'xlsx';
        const body = scope === 'ticked' ? { format, reason: reason.trim(), ids: picked() } : { format, reason: reason.trim(), filters };
        const res = await fetch('/members/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) return void toast.error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Export failed');
        const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `members.${format}`;
        const url = URL.createObjectURL(await res.blob());
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Downloaded ${name}`);
      } else if (mode) {
        const ids = picked();
        const input =
          mode === 'segment'
            ? { action: mode, ids, category: value, reason: reason.trim() }
            : { action: mode, ids, tag: value.trim().toLowerCase(), reason: reason.trim() };
        const r = await memberBulkAction(input);
        if (!r.ok) return void toast.error(r.error);
        const { done, skipped } = r.data;
        if (skipped.length) toast.warning(`${done} done, ${skipped.length} skipped: ${skipped.slice(0, 3).map((s) => s.why).join('; ')}`);
        else toast.success(`${done} member${done === 1 ? '' : 's'} updated`);
        clear();
        router.refresh();
      }
      setMode(null);
      setReason('');
    });

  const chip = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold shadow-sm transition hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0';
  const field = 'rounded-xl border border-border bg-surface px-3 py-1.5 text-[13px]';
  return (
    <div className={`sticky top-16 z-20 rounded-2xl border px-4 py-2.5 shadow-soft backdrop-blur transition ${count ? 'border-accent/40 bg-[color-mix(in_oklab,var(--accent)_8%,var(--surface))]' : 'border-border bg-surface/95'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[#0ea5e9] to-[#6366f1] text-white shadow-sm">
            <ListChecks className="size-3.5" aria-hidden />
          </span>
          {count ? `${count} ticked` : 'Bulk actions'}
        </span>
        <TopicInfo
          title="Bulk actions and download"
          help={{
            why: 'Do the same thing to many members at once, or take the list to Excel, instead of one member at a time.',
            where: 'Tags stay in MADP. A segment change goes to the panel, one member at a time, as on the member page. Downloads hold masked e-mail and phone only.',
            how: [
              'Tick members in the table (the top box ticks the whole page), then pick an action.',
              'Give a reason: it goes to the audit log with who did it.',
              'Download: pick Excel or CSV, and either the ticked members or the whole filtered list (up to 2,000).',
            ],
          }}
        />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {canEdit ? (
            <>
              <button type="button" disabled={!count} onClick={() => open('tag_add')} className={`${chip} bg-gradient-to-r from-[#f59e0b] to-[#ec4899] text-white`}>
                <Tag className="size-3.5" aria-hidden /> Add tag
              </button>
              <button type="button" disabled={!count} onClick={() => open('tag_remove')} className={`${chip} border border-border bg-surface text-fg-2`}>
                <Tags className="size-3.5" aria-hidden /> Remove tag
              </button>
            </>
          ) : null}
          {canSegment ? (
            <button type="button" disabled={!count} onClick={() => open('segment')} className={`${chip} bg-gradient-to-r from-[#14b8a6] to-[#0ea5e9] text-white`}>
              <Layers className="size-3.5" aria-hidden /> Change segment
            </button>
          ) : null}
          {canExport ? (
            <button type="button" onClick={() => open('export')} className={`${chip} bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-white`} title="Download as Excel or CSV">
              <Download className="size-3.5" aria-hidden /> Download
            </button>
          ) : null}
          {count ? (
            <button type="button" onClick={clear} className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2" aria-label="Untick all">
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      {mode ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="rise mt-2.5 grid gap-2 border-t border-border pt-2.5 text-[13px] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end"
        >
          {mode === 'export' ? (
            <div className="grid gap-1">
              <span className="text-[12px] text-fg-3">File and members</span>
              <div className="flex flex-wrap gap-1.5">
                {(['xlsx', 'csv'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={(value || 'xlsx') === f}
                    onClick={() => setValue(f)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${(value || 'xlsx') === f ? 'border-accent bg-accent text-white' : 'border-border text-fg-2'}`}
                  >
                    {f === 'xlsx' ? <FileSpreadsheet className="size-3.5" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
                    {f === 'xlsx' ? 'Excel' : 'CSV'}
                  </button>
                ))}
                <select value={scope} onChange={(e) => setScope(e.target.value as 'ticked' | 'all')} className="rounded-lg border border-border bg-surface px-2 py-1 text-[12px]" aria-label="Which members">
                  {count ? <option value="ticked">{count} ticked</option> : null}
                  <option value="all">All {Math.min(total, 2000).toLocaleString()} filtered</option>
                </select>
              </div>
            </div>
          ) : mode === 'segment' ? (
            <label className="grid gap-1">
              <span className="text-[12px] text-fg-3">New segment</span>
              <select value={value} onChange={(e) => setValue(e.target.value)} className={field}>
                {categories.filter((c) => !c.minor).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.segments.join(', ')} ({c.value})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="grid gap-1">
              <span className="text-[12px] text-fg-3">{mode === 'tag_add' ? 'Tag to add' : 'Tag to remove'}</span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 30))}
                list="bulk-tags"
                required
                placeholder="vip"
                className={field}
              />
              <datalist id="bulk-tags">
                {tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-[12px] text-fg-3">Reason (kept in the audit log)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={500} placeholder="Why are you doing this?" className={field} />
          </label>
          <div className="flex gap-2">
            <button
              disabled={pending || !okReason || (mode !== 'export' && !value.trim())}
              className="inline-flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {mode === 'export' ? <Download className="size-3.5" aria-hidden /> : null}
              {pending ? 'Working…' : mode === 'export' ? 'Download' : `Apply to ${count}`}
            </button>
            <button type="button" onClick={() => setMode(null)} className="rounded-xl px-2 py-1.5 text-fg-3 hover:bg-surface-2" aria-label="Cancel">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
