'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { ClipboardCheck, Gift, LifeBuoy, Pause, Play, Radio, UserPlus, Volume2, VolumeX } from 'lucide-react';
import type { ActivityFeed, ActivityItem } from '@madp/contracts';
import { activityAction, openNewMembersAction } from '@/app/new-members-actions';
import { BrandLogo } from '@/components/brand-logo';
import { useNewMembers } from '@/components/new-members';
import { usePanels } from '@/components/panels-context';
import { cn } from '@/lib/cn';
import { panelName, panelShort } from '@/lib/panel-names';
import { PANEL_TONES } from '@/lib/panel-tones';

const POLL_MS = 20_000;
type Kind = ActivityItem['kind'];
const KINDS: { kind: Kind; label: string; icon: typeof UserPlus; tint: string }[] = [
  { kind: 'signup', label: 'Sign-ups', icon: UserPlus, tint: '#ec4899' },
  { kind: 'survey_complete', label: 'Survey completes', icon: ClipboardCheck, tint: '#14b8a6' },
  { kind: 'redemption', label: 'Redemptions', icon: Gift, tint: '#f59e0b' },
  { kind: 'ticket', label: 'New tickets', icon: LifeBuoy, tint: '#6366f1' },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<Kind, (typeof KINDS)[number]>;

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

function describe(i: ActivityItem, labels: Record<string, string>): string {
  switch (i.kind) {
    case 'signup':
      return `New member${i.segments.length ? ` · ${i.segments.map((s) => labels[s] ?? s).join(', ')}` : ''}${i.country ? ` · ${i.country.toUpperCase()}` : ''}`;
    case 'survey_complete':
      return `Survey complete${i.survey ? ` · ${i.survey}` : ''}${i.points ? ` · ${i.points} points` : ''}${i.country ? ` · ${i.country.toUpperCase()}` : ''}`;
    case 'redemption':
      return `Redeemed ${i.points} points`;
    case 'ticket':
      return `Ticket #${i.ticketNo}${i.category ? ` · ${i.category}` : ''} · ${i.priority} priority`;
  }
}

const TARGET: Record<Kind, string> = {
  signup: '/members?sort=signedUp&dir=desc',
  survey_complete: '/participation',
  redemption: '/rewards',
  ticket: '/tickets',
};

/** The live list: polls while the tab is visible, highlights and chimes for new lines, filters by kind and panel. */
export function LiveFeed() {
  const ctx = useNewMembers();
  const panels = usePanels();
  const router = useRouter();
  const [feed, setFeed] = useState<ActivityFeed | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(KINDS.map((k) => k.kind)));
  const [only, setOnly] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [, start] = useTransition();
  const seen = useRef<Set<string> | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const load = useCallback(async () => {
    if (pausedRef.current) return;
    const next = await activityAction();
    if (!next) return;
    const ids = new Set(next.items.map((i) => i.id));
    if (seen.current) {
      const added = next.items.filter((i) => !seen.current!.has(i.id)).map((i) => i.id);
      if (added.length) {
        setFresh(new Set(added));
        ctx?.ping();
      }
    }
    seen.current = new Set([...(seen.current ?? []), ...ids]);
    setFeed(next);
  }, [ctx]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const labels = ctx?.data?.segmentLabels ?? {};
  const shownPanels = [...new Set(feed?.items.map((i) => i.panel) ?? [])];
  const items = (feed?.items ?? []).filter((i) => kinds.has(i.kind) && (!only || i.panel === only));
  const counts = Object.fromEntries(KINDS.map((k) => [k.kind, feed?.items.filter((i) => i.kind === k.kind && (!only || i.panel === only)).length ?? 0]));

  const open = (i: ActivityItem) =>
    start(async () => {
      await openNewMembersAction(i.panel);
      router.push(TARGET[i.kind]);
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 shadow-soft">
        <span className="relative mr-1 inline-flex items-center gap-2 text-[13px] font-semibold text-fg">
          <span className="relative grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[#f43f5e] to-[#ec4899] text-white">
            <Radio className="size-3.5" aria-hidden />
            {!paused ? <span className="ping-soft absolute inset-0 rounded-lg bg-[#ec4899]" aria-hidden /> : null}
          </span>
          {paused ? 'Paused' : 'Live'}
        </span>
        {KINDS.map((k) => {
          const on = kinds.has(k.kind);
          return (
            <button
              key={k.kind}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setKinds((s) => {
                  const n = new Set(s);
                  if (on) n.delete(k.kind);
                  else n.add(k.kind);
                  return n;
                })
              }
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition', on ? 'text-white shadow-sm' : 'bg-surface text-fg-3')}
              style={on ? { background: k.tint, borderColor: k.tint } : { borderColor: 'var(--border)' }}
            >
              <k.icon className="size-3.5" aria-hidden /> {k.label}
              <span className={cn('rounded-full px-1.5 text-[11px] font-bold', on ? 'bg-white/25' : 'bg-surface-2')}>{counts[k.kind]}</span>
            </button>
          );
        })}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOnly(null)}
            aria-pressed={!only}
            className={cn('rounded-full border border-border px-2.5 py-1 text-[12px] font-medium', !only ? 'bg-fg text-bg' : 'text-fg-2')}
          >
            All panels
          </button>
          {shownPanels.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setOnly(only === p ? null : p)}
              aria-pressed={only === p}
              className={cn('inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-0.5 pr-2.5 text-[12px] font-medium', only === p ? 'ring-2 ring-accent' : '')}
            >
              <BrandLogo panel={p} label={panelShort(p, panels)} size={20} /> {panelShort(p, panels)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPaused((x) => !x)}
            className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg"
            aria-label={paused ? 'Resume live updates' : 'Pause live updates'}
          >
            {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          </button>
          {ctx ? (
            <button
              type="button"
              onClick={() => ctx.setSound(!ctx.sound)}
              aria-pressed={ctx.sound}
              className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg"
              aria-label={ctx.sound ? 'Sound on: turn it off' : 'Sound off: turn it on'}
            >
              {ctx.sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
            </button>
          ) : null}
        </div>
      </div>

      {feed?.dataMode === 'demo' ? (
        <p className="rounded-xl bg-[color-mix(in_oklab,#f59e0b_12%,transparent)] px-3 py-2 text-[12px] text-fg-2">DEMO data: these are test events, not real activity.</p>
      ) : null}
      {feed?.unreachable.length ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-[12px] text-fg-2">
          New tickets could not be read from {feed.unreachable.map((p) => panelShort(p, panels)).join(', ')} this time (panel admin API not answering).
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
        {!feed ? (
          <p className="px-5 py-10 text-center text-[13px] text-fg-3">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-fg-3">Nothing in the last 3 days for these filters.</p>
        ) : (
          <ol className="relative divide-y divide-border">
            {items.map((i) => {
              const m = META[i.kind];
              const [a, b] = PANEL_TONES[i.panel] ?? ['#a78bfa', '#7c3aed'];
              return (
                <li key={i.id} className={cn('relative', fresh.has(i.id) ? 'rise bg-[color-mix(in_oklab,#ec4899_6%,transparent)]' : '')}>
                  <button type="button" onClick={() => open(i)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 sm:px-5">
                    <span className="absolute inset-y-2 left-0 w-1 rounded-r-full" style={{ backgroundImage: `linear-gradient(${a}, ${b})` }} aria-hidden />
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl text-white shadow-md" style={{ background: m.tint }}>
                      <m.icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-fg">{describe(i, labels)}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-fg-3">
                        <BrandLogo panel={i.panel} label={panelShort(i.panel, panels)} size={16} />
                        {panelName(i.panel, panels)}
                      </span>
                    </span>
                    {fresh.has(i.id) ? (
                      <span className="hidden rounded-full bg-gradient-to-r from-[#f43f5e] to-[#ec4899] px-2 py-0.5 text-[10px] font-bold uppercase text-white sm:inline">New</span>
                    ) : null}
                    <span className="shrink-0 text-[12px] text-fg-3">{ago(i.at)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
