'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Bookmark, BookmarkPlus, Check, Trash2, Users, X } from 'lucide-react';
import type { MemberView, MemberViewParams } from '@madp/contracts';
import { deleteMemberViewAction, saveMemberViewAction } from '@/app/member-views-actions';
import { TopicInfo } from '@/components/screen-info';
import { cn } from '@/lib/cn';

const TINTS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#0ea5e9', '#a855f7', '#22c55e', '#f43f5e'];

const LABELS: Partial<Record<keyof MemberViewParams, string>> = {
  status: 'status',
  category: 'segment',
  marketing: 'marketing',
  country: 'country',
  from: 'signed up from',
  to: 'signed up to',
  lastDays: 'last days',
  qualityMin: 'quality from',
  qualityMax: 'quality to',
  inactiveSince: 'no activity since',
  dueBefore: 'due by',
  bornFrom: 'born from',
  bornTo: 'born to',
  gender: 'gender',
  ageMin: 'age from',
  ageMax: 'age to',
  tag: 'tag',
  sort: 'sorted by',
};

/** What a view keeps, in words, for its tooltip. */
const describe = (p: MemberViewParams) =>
  Object.entries(p)
    .filter(([k]) => k !== 'dir' && LABELS[k as keyof MemberViewParams])
    .map(([k, v]) => `${LABELS[k as keyof MemberViewParams]} ${k === 'sort' ? `${v} ${p.dir ?? ''}` : v}`)
    .join(', ') || 'all members';

const hrefOf = (p: MemberViewParams) =>
  `/members?${new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]))}`;

const same = (a: MemberViewParams, b: MemberViewParams) => {
  const ka = Object.keys(a).filter((k) => a[k as keyof MemberViewParams] !== undefined).sort();
  const kb = Object.keys(b).filter((k) => b[k as keyof MemberViewParams] !== undefined).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && String(a[k as keyof MemberViewParams]) === String(b[k as keyof MemberViewParams]));
};

/**
 * One-click chips for saved filter + sort combinations on the Members table, and a "Save this view" form. Views keep
 * list filters only: a search for one person is never saved.
 */
export function SavedViews({
  views,
  current,
  searching,
}: {
  views: MemberView[];
  current: MemberViewParams;
  /** True while a person search (e-mail, phone, name or id) is on: that part is not saved. */
  searching: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [rolling, setRolling] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasFilters = Object.keys(current).length > 0;

  const save = () =>
    start(async () => {
      setError(null);
      const params: MemberViewParams = { ...current };
      const days = Number(rolling);
      if (rolling && Number.isInteger(days) && days > 0) {
        delete params.from;
        params.lastDays = days;
      }
      const r = await saveMemberViewAction({ name: name.trim(), params, shared });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      setName('');
      setRolling('');
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      const r = await deleteMemberViewAction(id);
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-white shadow-sm">
            <Bookmark className="size-3.5" aria-hidden />
          </span>
          Saved views
        </span>
        <TopicInfo
          title="Saved views"
          help={{
            why: 'Open the lists you use often in one click, such as "New consumers in India this week", on any panel.',
            where: 'Kept in MADP per brand: your own views, plus views other admins shared on this brand. Only filters and sort are kept, never a search for one person.',
            how: [
              'Set the filters and sort on the table, then press Save this view and give it a name.',
              'Rolling dates: fill "last N days" so the view always means "signed up in the last N days".',
              'Tick "Share" to show it to every admin of this brand. Only you can delete your views.',
            ],
          }}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {views.length === 0 ? (
            <span className="text-[12px] text-fg-3">None yet. Set filters below and save them here.</span>
          ) : null}
          {views.map((v, i) => {
            const tint = TINTS[i % TINTS.length]!;
            const active = same(v.params, current);
            return (
              <span
                key={v.id}
                className={cn(
                  'group inline-flex max-w-full items-center rounded-full border text-[12px] font-medium transition hover:-translate-y-px',
                  active ? 'text-white shadow-md' : '',
                )}
                style={
                  active
                    ? { background: tint, borderColor: tint }
                    : { background: `color-mix(in oklab, ${tint} 10%, transparent)`, borderColor: `color-mix(in oklab, ${tint} 30%, transparent)`, color: tint }
                }
              >
                <Link
                  href={hrefOf(v.params)}
                  title={`${describe(v.params)}${v.mine ? '' : ` · shared by ${v.createdBy}`}`}
                  className="inline-flex min-w-0 items-center gap-1 py-1 pl-2.5 pr-2"
                >
                  {v.shared ? <Users className="size-3 shrink-0" aria-label="Shared" /> : null}
                  <span className="truncate">{v.name}</span>
                </Link>
                {v.mine ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(v.id)}
                    aria-label={`Delete view ${v.name}`}
                    className="mr-1 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!hasFilters}
          title={hasFilters ? 'Save the filters and sort shown now' : 'Set a filter or sort first'}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#6366f1] to-[#a855f7] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:-translate-y-px disabled:opacity-40"
        >
          <BookmarkPlus className="size-3.5" aria-hidden /> Save this view
        </button>
      </div>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="rise mt-3 grid gap-2 border-t border-border pt-3 text-[13px] sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        >
          <label className="grid gap-1">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={60}
              placeholder="New consumers in India"
              className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm"
            />
          </label>
          <label className="grid gap-1">
            Signed up in the last N days (optional)
            <input
              value={rolling}
              onChange={(e) => setRolling(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="7"
              className="w-full rounded-xl border border-border bg-surface px-3 py-1.5 text-sm sm:w-28"
            />
          </label>
          <label className="inline-flex items-center gap-2 pb-1.5">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with this brand&apos;s admins
          </label>
          <div className="flex gap-2">
            <button
              disabled={pending || name.trim().length < 2}
              className="inline-flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              <Check className="size-3.5" aria-hidden /> Save
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-2 py-1.5 text-fg-3 hover:bg-surface-2" aria-label="Cancel">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-[12px] text-fg-3 sm:col-span-4">
            Keeps: {describe(current)}.
            {searching ? ' The search for one person (e-mail, phone, name or id) is not saved.' : ''}
          </p>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
