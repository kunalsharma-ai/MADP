'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Siren } from 'lucide-react';
import { ALERT_METRIC_LABELS, type AlertRules } from '@madp/contracts';
import { alertRulesAction } from '@/app/alert-rules-actions';
import { cn } from '@/lib/cn';
import { panelShort } from '@/lib/panel-names';
import { BrandLogo } from './brand-logo';
import { usePanels } from './panels-context';

const POLL_MS = 120_000;
const fmtN = (n: number) => new Intl.NumberFormat('en-IN').format(n);

/**
 * The amber siren next to the bell: your own alert rules that are firing now (for example "MHO sign-ups in the last
 * hour above 20"). Hidden until you have a rule. Rules are set on the Alert rules screen.
 */
export function RuleAlert() {
  const panels = usePanels();
  const [data, setData] = useState<AlertRules | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const seen = useRef(-1);

  const load = useCallback(async () => {
    const d = await alertRulesAction();
    setData(d);
    // a short chime when a rule starts firing while the console is open
    if (d && d.firing.length > seen.current && seen.current >= 0) {
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 660;
        g.gain.setValueAtTime(0.06, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.4);
      } catch {
        /* no sound allowed yet */
      }
    }
    if (d) seen.current = d.firing.length;
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) =>
      box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!data || !data.rules.length) return null;
  const n = data.firing.length;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={n ? `${n} of your alert rules firing` : 'Your alert rules: all quiet'}
        title="Your alert rules"
        className={cn(
          'relative grid size-9 place-items-center rounded-xl border bg-surface shadow-soft transition hover:-translate-y-px',
          n ? 'border-[#f59e0b]/60 text-[#d97706]' : 'border-border text-fg-2 hover:text-fg',
        )}
      >
        <Siren className={cn('size-[18px]', n ? 'bell-swing' : '')} aria-hidden />
        {n ? (
          <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-br from-[#f59e0b] to-[#d97706] px-1.5 text-[11px] font-bold text-white shadow-[0_4px_10px_-2px_rgba(245,158,11,0.7)]">
            {n > 99 ? '99+' : n}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label="Your alert rules"
          className="pop-in fixed inset-x-4 top-16 z-40 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[22rem]"
        >
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#f59e0b] to-[#f97316] px-4 py-2.5 text-white">
            <Siren className="size-4" aria-hidden />
            <p className="text-[13px] font-bold">Your alert rules</p>
          </div>
          {n ? (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {data.firing.map((f) => (
                <li key={`${f.ruleId}:${f.panel}`} className="flex items-center gap-3 px-4 py-2.5">
                  <BrandLogo panel={f.panel} label={panelShort(f.panel, panels)} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{f.name}</p>
                    <p className="text-[11px] text-fg-2">
                      {ALERT_METRIC_LABELS[f.metric]} in the last {f.window}: <strong>{fmtN(f.value)}</strong>{' '}
                      ({f.comparator} {fmtN(f.threshold)})
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-[12px] text-fg-2">
              All quiet: none of your {data.rules.length} rules is firing.
            </p>
          )}
          <Link
            href="/alert-rules"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-[12px] font-semibold text-accent hover:bg-surface-2"
          >
            Manage alert rules
          </Link>
        </div>
      ) : null}
    </div>
  );
}
