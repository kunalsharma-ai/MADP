'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { ArrowRight, Bell, BellRing, Check, Info, UserPlus, Volume2, VolumeX, X } from 'lucide-react';
import {
  markNewMembersSeenAction,
  newMembersAction,
  openNewMembersAction,
  type NewMembersView,
} from '@/app/new-members-actions';
import { cn } from '@/lib/cn';
import { panelName, panelShort } from '@/lib/panel-names';
import { PANEL_TONES } from '@/lib/panel-tones';
import { BrandLogo } from './brand-logo';
import { usePanels } from './panels-context';
import { TopicInfo, type TopicHelp } from './screen-info';

/** How often the console asks for new sign-ups. MADP learns about them at each panel sync. */
const POLL_MS = 30_000;
const SOUND_KEY = 'madp.newMembers.sound';
const LAST_KEY = 'madp.newMembers.last';

const tone = (panel: string): [string, string] => PANEL_TONES[panel] ?? ['#a78bfa', '#7c3aed'];
const SEGMENT_TONES: Record<string, string> = {
  consumer: '#6366f1',
  business_professional: '#0ea5e9',
  healthcare_professional: '#14b8a6',
  patient: '#ec4899',
  caregiver: '#f59e0b',
  teen: '#a855f7',
};
const segTone = (k: string) => SEGMENT_TONES[k] ?? '#64748b';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private window: the setting lasts for this page only */
  }
}

/** A short, friendly two-note chime made in the browser: no sound file to load. */
function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const [i, f] of [880, 1318.5].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = now + i * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.5);
  }
}

interface Toast {
  id: number;
  panel: string;
  added: number;
  segments: { key: string; count: number }[];
}

interface Ctx {
  data: NewMembersView | null;
  sound: boolean;
  setSound: (on: boolean) => void;
  markSeen: (panel?: string) => Promise<void>;
  refresh: () => Promise<void>;
  countFor: (panel: string) => number;
}

const NewMembersContext = createContext<Ctx | null>(null);

export function useNewMembers(): Ctx | null {
  return useContext(NewMembersContext);
}

/**
 * Asks for new sign-ups every 30 seconds while the tab is open, plays a chime and shows a pop-up when a panel's
 * count goes up, and gives the bell, the menu badge and the big panel tiles the same numbers.
 */
export function NewMembersProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<NewMembersView | null>(null);
  const [sound, setSoundState] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const last = useRef<Record<string, number> | null>(null);
  const soundRef = useRef(true);
  const toastId = useRef(0);

  useEffect(() => {
    const s = read(SOUND_KEY) !== 'off';
    setSoundState(s);
    soundRef.current = s;
    try {
      const raw = window.sessionStorage.getItem(LAST_KEY);
      if (raw) last.current = JSON.parse(raw) as Record<string, number>;
    } catch {
      /* ignore */
    }
    // Browsers only allow sound after the admin has clicked or typed on the page once.
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        /* no Web Audio: alerts still pop up, silently */
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const apply = useCallback((next: NewMembersView) => {
    const totals = Object.fromEntries(next.panels.map((p) => [p.panel, p.total]));
    const before = last.current;
    if (before) {
      const fresh: Toast[] = [];
      for (const p of next.panels) {
        const added = p.total - (before[p.panel] ?? 0);
        if (added > 0)
          fresh.push({ id: ++toastId.current, panel: p.panel, added, segments: p.segments.slice(0, 4) });
      }
      if (fresh.length) {
        setToasts((t) => [...t, ...fresh].slice(-4));
        if (soundRef.current && audio.current?.state === 'running') chime(audio.current);
      }
    }
    last.current = totals;
    try {
      window.sessionStorage.setItem(LAST_KEY, JSON.stringify(totals));
    } catch {
      /* ignore */
    }
    setData(next);
  }, []);

  const refresh = useCallback(async () => {
    const next = await newMembersAction();
    if (next) apply(next);
  }, [apply]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const setSound = useCallback((on: boolean) => {
    setSoundState(on);
    soundRef.current = on;
    write(SOUND_KEY, on ? 'on' : 'off');
    if (on && audio.current) {
      void audio.current.resume().then(() => audio.current && chime(audio.current));
    }
  }, []);

  const markSeen = useCallback(
    async (panel?: string) => {
      await markNewMembersSeenAction(panel);
      await refresh();
    },
    [refresh],
  );

  const countFor = useCallback(
    (panel: string) => data?.panels.find((p) => p.panel === panel)?.total ?? 0,
    [data],
  );

  useEffect(() => {
    if (!toasts.length) return;
    const t = window.setTimeout(() => setToasts((x) => x.slice(1)), 9000);
    return () => window.clearTimeout(t);
  }, [toasts]);

  return (
    <NewMembersContext.Provider value={{ data, sound, setSound, markSeen, refresh, countFor }}>
      {children}
      <Toasts
        toasts={toasts}
        labels={data?.segmentLabels ?? {}}
        onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
      />
    </NewMembersContext.Provider>
  );
}

function Toasts({
  toasts,
  labels,
  onClose,
}: {
  toasts: Toast[];
  labels: Record<string, string>;
  onClose: (id: number) => void;
}) {
  const panels = usePanels();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:left-auto sm:right-6 sm:w-[22rem]"
    >
      {toasts.map((t) => {
        const [a, b] = tone(t.panel);
        return (
          <div
            key={t.id}
            role="status"
            className="rise pointer-events-auto overflow-hidden rounded-2xl border border-border bg-surface shadow-lift"
          >
            <div className="h-1.5" style={{ backgroundImage: `linear-gradient(90deg, ${a}, ${b})` }} aria-hidden />
            <div className="flex items-start gap-3 p-3.5">
              <div className="relative">
                <BrandLogo panel={t.panel} label={panelShort(t.panel, panels)} size={40} />
                <span
                  className="absolute -right-2 -top-2 grid min-w-6 place-items-center rounded-full px-1.5 text-[12px] font-bold text-white shadow-md"
                  style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }}
                >
                  +{t.added}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-fg">
                  {t.added === 1 ? 'New member' : `${t.added} new members`} on {panelName(t.panel, panels)}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.segments.map((s) => (
                    <SegmentPill key={s.key} k={s.key} label={labels[s.key] ?? s.key} count={s.count} small />
                  ))}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => onClose(t.id)}
                className="rounded-full p-1 text-fg-3 hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SegmentPill({ k, label, count, small }: { k: string; label: string; count: number; small?: boolean }) {
  const c = segTone(k);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]',
      )}
      style={{ background: `color-mix(in oklab, ${c} 13%, transparent)`, color: c }}
    >
      {label}
      <span
        className={cn('grid place-items-center rounded-full font-bold text-white', small ? 'min-w-4 px-1 text-[10px]' : 'min-w-5 px-1.5 text-[11px]')}
        style={{ background: c }}
      >
        {count}
      </span>
    </span>
  );
}

const timeAgo = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** The bell in the top bar: total new sign-ups, and a panel per brand with the count per segment. */
export function NewMembersBell() {
  const ctx = useNewMembers();
  const panels = usePanels();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  if (!ctx?.data || !ctx.data.panels.length) return null;
  const { data } = ctx;
  const total = data.total;
  const Icon = total ? BellRing : Bell;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={total ? `${total} new members` : 'New members: none'}
        title="New member sign-ups"
        className={cn(
          'relative grid size-9 place-items-center rounded-xl border border-border bg-surface text-fg-2 shadow-soft transition hover:-translate-y-px hover:text-fg',
          total ? 'text-[#a855f7]' : '',
        )}
      >
        <Icon className={cn('size-[18px]', total ? 'bell-swing' : '')} aria-hidden />
        {total ? (
          <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-br from-[#f43f5e] to-[#ec4899] px-1.5 text-[11px] font-bold text-white shadow-[0_4px_10px_-2px_rgba(236,72,153,0.7)]">
            {total > 999 ? '999+' : total}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label="New members"
          className="rise fixed inset-x-4 top-[4.5rem] z-40 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl border border-border bg-surface shadow-lift sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[26rem]"
        >
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#6366f1] via-[#a855f7] to-[#ec4899] px-4 py-3 text-white">
            <UserPlus className="size-4" aria-hidden />
            <p className="text-sm font-semibold">New members</p>
            <span className="rounded-full bg-white/25 px-2 py-0.5 text-[12px] font-bold">{total}</span>
            <button
              type="button"
              onClick={() => setHelp((h) => !h)}
              aria-expanded={help}
              aria-label="How new-member alerts work"
              className="ml-auto rounded-full p-1 text-white/90 hover:bg-white/20"
            >
              <Info className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => ctx.setSound(!ctx.sound)}
              aria-pressed={ctx.sound}
              aria-label={ctx.sound ? 'Sound on: turn it off' : 'Sound off: turn it on'}
              title={ctx.sound ? 'Sound on' : 'Sound off'}
              className="rounded-full p-1 text-white/90 hover:bg-white/20"
            >
              {ctx.sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
            </button>
          </div>
          {help ? <AlertHelp /> : null}
          {data.dataMode === 'demo' ? (
            <p className="border-b border-border bg-[color-mix(in_oklab,#f59e0b_12%,transparent)] px-4 py-2 text-[12px] text-fg-2">
              DEMO data: these are test members, not real sign-ups.
            </p>
          ) : null}
          <div className="grid gap-2.5 p-3">
            {data.panels.map((p) => (
              <PanelCard key={p.panel} p={p} labels={data.segmentLabels} compact onDone={() => setOpen(false)} />
            ))}
          </div>
          {data.recent.length ? (
            <div className="border-t border-border px-4 py-3">
              <p className="pb-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-3">Latest sign-ups</p>
              <ul className="divide-y divide-border text-[12px]">
                {data.recent.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 py-1.5">
                    <BrandLogo panel={r.panel} label={panelShort(r.panel, panels)} size={20} />
                    <span className="min-w-0 flex-1 truncate text-fg-2">
                      {r.segments.map((s) => data.segmentLabels[s] ?? s).join(', ') || 'No segment yet'}
                      {r.country ? ` · ${r.country.toUpperCase()}` : ''}
                    </span>
                    <span className="shrink-0 text-fg-3">{timeAgo(r.signedUpAt ?? r.arrivedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {total ? (
            <div className="flex justify-end border-t border-border px-4 py-2.5">
              <button
                type="button"
                onClick={() => void ctx.markSeen()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft"
              >
                <Check className="size-3.5" aria-hidden /> Mark all as seen
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const NEW_MEMBERS_HELP: TopicHelp = {
  why: 'So you see every new T2O, MFR and MHO sign-up as soon as MADP knows about it, with a sound, a pop-up and a count per panel and per segment.',
  where:
    "MADP's own copy of the panels, filled at each panel sync (its interval is on Panel connections). Only counts, segment, country and time are shown, never names or e-mails. Teens count only for admins with teen access.",
  how: [
    'A number is how many joined since you last pressed Seen on that panel (the first time, the last 24 hours).',
    'See them opens Members for that panel, newest sign-ups first.',
    'The speaker button in the bell turns the sound on or off for this browser. The browser plays sound only after you have clicked once on the page.',
  ],
};

function AlertHelp() {
  const h = NEW_MEMBERS_HELP;
  return (
    <div className="grid gap-2 border-b border-border bg-surface-2/60 px-4 py-3 text-[12px] leading-relaxed text-fg-2">
      <p>
        <b className="text-fg">Why:</b> {h.why}
      </p>
      <p>
        <b className="text-fg">Where:</b> {h.where}
      </p>
      <div>
        <b className="text-fg">How:</b>
        <ul className="ml-4 list-disc">
          {h.how.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PanelCard({
  p,
  labels,
  compact,
  onDone,
}: {
  p: NewMembersView['panels'][number];
  labels: Record<string, string>;
  compact?: boolean;
  onDone?: () => void;
}) {
  const ctx = useNewMembers();
  const panels = usePanels();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [a, b] = tone(p.panel);
  const open = () =>
    start(async () => {
      await openNewMembersAction(p.panel);
      onDone?.();
      router.push(`/members?from=${p.since.slice(0, 10)}&sort=signedUp&dir=desc`);
      router.refresh();
    });
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-border bg-surface transition',
        compact ? 'p-3' : 'p-4 shadow-soft hover:-translate-y-1 hover:shadow-lift',
      )}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-20 blur-2xl"
        style={{ background: b }}
        aria-hidden
      />
      <div className="relative flex items-center gap-3">
        <BrandLogo panel={p.panel} label={panelShort(p.panel, panels)} size={compact ? 36 : 44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-fg">{panelName(p.panel, panels)}</p>
          <p className="text-[11px] text-fg-3">since {new Date(p.since).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <span
          className={cn(
            'grid place-items-center rounded-2xl font-extrabold tabular-nums text-white shadow-md',
            compact ? 'h-10 min-w-10 px-2 text-lg' : 'h-14 min-w-14 px-3 text-2xl',
            p.total ? 'pop-in' : 'opacity-40',
          )}
          style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }}
          aria-label={`${p.total} new`}
        >
          {p.total > 9999 ? '9999+' : p.total}
        </span>
      </div>
      {p.segments.length ? (
        <div className="relative mt-2.5 flex flex-wrap gap-1.5">
          {p.segments.map((s) => (
            <SegmentPill key={s.key} k={s.key} label={labels[s.key] ?? s.key} count={s.count} />
          ))}
        </div>
      ) : (
        <p className="relative mt-2 text-[12px] text-fg-3">No new sign-ups.</p>
      )}
      {p.teensHidden ? <p className="relative mt-1.5 text-[11px] text-fg-3">Teens are not counted: no teen access.</p> : null}
      {p.total ? (
        <div className="relative mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={open}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-white shadow-sm disabled:opacity-60"
            style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }}
          >
            See them <ArrowRight className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void ctx?.markSeen(p.panel)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[12px] font-semibold text-fg-2 hover:bg-surface-2"
          >
            <Check className="size-3.5" aria-hidden /> Seen
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Big tiles, one per panel, with the count per segment: for the dashboard and the Members screen. */
export function NewMembersStrip({ only }: { only?: string }) {
  const ctx = useNewMembers();
  if (!ctx?.data?.panels.length) return null;
  const list = only ? ctx.data.panels.filter((p) => p.panel === only) : ctx.data.panels;
  if (!list.length) return null;
  return (
    <section aria-label="New members" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-[#f43f5e] to-[#ec4899] text-white shadow-md">
          <UserPlus className="size-4" aria-hidden />
        </span>
        <h2 className="text-[15px] font-bold text-fg">New members</h2>
        <TopicInfo title="New members" help={NEW_MEMBERS_HELP} />
        {ctx.data.dataMode === 'demo' ? (
          <span className="rounded-full bg-[color-mix(in_oklab,#f59e0b_16%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[#b45309]">
            DEMO
          </span>
        ) : null}
        <span className="text-[12px] text-fg-3">since you last marked each panel as seen</span>
      </div>
      <div className={cn('grid gap-3', list.length > 1 ? 'sm:grid-cols-2 xl:grid-cols-3' : '')}>
        {list.map((p) => (
          <PanelCard key={p.panel} p={p} labels={ctx.data!.segmentLabels} />
        ))}
      </div>
    </section>
  );
}

/** Small count on the Members menu item for the brand picked at the top (or every brand). */
export function NewMembersNavBadge({ brand }: { brand: string }) {
  const ctx = useNewMembers();
  const n = brand === 'all' ? (ctx?.data?.total ?? 0) : (ctx?.countFor(brand) ?? 0);
  if (!n) return null;
  return (
    <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-br from-[#f43f5e] to-[#ec4899] px-1.5 text-[11px] font-bold text-white shadow-sm">
      {n > 999 ? '999+' : n}
    </span>
  );
}
