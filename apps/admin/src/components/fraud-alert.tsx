'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { Check, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { FraudAlerts } from '@madp/contracts';
import { fraudAlertsAction, markFraudSeenAction, openNewMembersAction } from '@/app/new-members-actions';
import { cn } from '@/lib/cn';
import { panelName, panelShort } from '@/lib/panel-names';
import { BrandLogo } from './brand-logo';
import { usePanels } from './panels-context';
import { TopicInfo } from './screen-info';

const POLL_MS = 120_000;
const RULE_LABEL = {
  phone: 'same phone',
  email: 'same e-mail',
  name_dob: 'same name and birth date',
  ip: 'same sign-up IP',
  device: 'same device',
} as const;

/**
 * The red shield next to the bell: accounts on a panel that share a phone, an e-mail, or a name with a birth date.
 * Red while a group has an account that signed up since you last looked. Opens the Duplicates screen of that panel.
 */
export function FraudAlert() {
  const panels = usePanels();
  const router = useRouter();
  const [data, setData] = useState<FraudAlerts | null>(null);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  const load = useCallback(async () => setData(await fraudAlertsAction()), []);
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

  if (!data || (!data.panels.length && !data.unreachable.length)) return null;
  const total = data.total;
  const groups = (p: FraudAlerts['panels'][number]) =>
    Object.values(p.groups).reduce((n, x) => n + (x ?? 0), 0);
  const go = (panel: string, by: string) =>
    start(async () => {
      await Promise.all([openNewMembersAction(panel), markFraudSeenAction(panel)]);
      setOpen(false);
      router.push(`/members/duplicates?by=${by}`);
      router.refresh();
      void load();
    });
  const seenAll = () =>
    start(async () => {
      await markFraudSeenAction();
      await load();
    });
  const Icon = total ? ShieldAlert : ShieldCheck;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={
          total ? `${total} new possible duplicate accounts` : 'Possible duplicate accounts: nothing new'
        }
        title="Possible duplicate accounts"
        className={cn(
          'relative grid size-9 place-items-center rounded-xl border bg-surface shadow-soft transition hover:-translate-y-px',
          total ? 'border-[#ef4444]/50 text-[#ef4444]' : 'border-border text-fg-2 hover:text-fg',
        )}
      >
        <Icon className={cn('size-[18px]', total ? 'bell-swing' : '')} aria-hidden />
        {total ? (
          <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-br from-[#ef4444] to-[#b91c1c] px-1.5 text-[11px] font-bold text-white shadow-[0_4px_10px_-2px_rgba(239,68,68,0.7)]">
            {total > 99 ? '99+' : total}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label="Possible duplicate accounts"
          className="pop-in fixed inset-x-4 top-16 z-40 overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[22rem] rounded-2xl border border-border bg-surface shadow-2xl"
        >
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#ef4444] to-[#f97316] px-4 py-2.5 text-white">
            <ShieldAlert className="size-4" aria-hidden />
            <p className="text-[13px] font-bold">Possible duplicate accounts</p>
            <TopicInfo
              title="Duplicate and fraud alert"
              help={{
                why: 'Two accounts with the same phone, e-mail, or name and birth date are often one person collecting rewards twice.',
                where:
                  'Each panel checks its own members every 10 minutes. Only counts come here; the Duplicates screen shows the masked accounts.',
                how: [
                  'Red means a matching account signed up since you last looked.',
                  'Open a panel to compare the accounts, then merge them or leave them.',
                  'Teens are never listed. Same device or IP needs a panel update first.',
                ],
              }}
            />
          </div>
          <ul className="divide-y divide-border">
            {data.panels.map((p) => (
              <li key={p.panel} className="flex items-center gap-3 px-4 py-3">
                <BrandLogo panel={p.panel} label={panelShort(p.panel, panels)} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-fg">{panelName(p.panel, panels)}</p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {(Object.keys(RULE_LABEL) as (keyof typeof RULE_LABEL)[]).map((k) =>
                      p.groups[k] ? (
                        <button
                          key={k}
                          type="button"
                          onClick={() => go(p.panel, k)}
                          className="rounded-full bg-[color-mix(in_oklab,#ef4444_10%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[#b91c1c] hover:underline dark:text-[#fca5a5]"
                        >
                          {p.groups[k]}
                          {p.more ? '+' : ''} {RULE_LABEL[k]}
                        </button>
                      ) : null,
                    )}
                    {!groups(p) ? <span className="text-[11px] text-fg-3">No duplicates found</span> : null}
                  </div>
                </div>
                {p.fresh ? (
                  <span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-[11px] font-bold text-white">
                    {p.fresh} new
                  </span>
                ) : null}
              </li>
            ))}
            {data.unreachable.length ? (
              <li className="px-4 py-2.5 text-[12px] text-fg-3">
                Not checked: {data.unreachable.map((p) => panelShort(p, panels)).join(', ')} (panel admin API
                not answering).
              </li>
            ) : null}
          </ul>
          {total ? (
            <button
              type="button"
              onClick={seenAll}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-[12px] font-semibold text-fg-2 hover:bg-surface-2"
            >
              <Check className="size-3.5" aria-hidden /> Mark all as seen
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
