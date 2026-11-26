'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Info, Lightbulb, ListChecks, MapPin, X } from 'lucide-react';
import { NAV } from './nav';
import { helpFor } from '@/lib/screen-help';

/** The "i" button beside every page title: why the screen exists, where its data lives, and how to use it. */
export function ScreenInfo() {
  const path = usePathname();
  const found = helpFor(path);
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
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
  if (!found) return null;
  const { help, key } = found;
  const menu = NAV.flatMap((g) => g.items.map((i) => ({ group: g.label, ...i }))).find((i) => i.href === key);
  return (
    <div ref={box} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label="About this screen"
        aria-expanded={open}
        aria-controls={id}
        title="Why, where and how to use this screen"
        onClick={() => setOpen((o) => !o)}
        className="group relative ml-2.5 inline-grid size-7 place-items-center rounded-full bg-gradient-to-br from-[#6366f1] via-[#a855f7] to-[#ec4899] text-white shadow-[0_6px_16px_-6px_rgba(168,85,247,0.8)] transition duration-200 hover:scale-110 hover:rotate-12"
      >
        <span className="ping-soft absolute inset-0 rounded-full bg-[#a855f7]" style={{ animationIterationCount: 3 }} aria-hidden />
        <Info className="relative size-4" strokeWidth={2.5} aria-hidden />
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label="About this screen"
          className="rise absolute left-0 top-9 z-30 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface text-[13px] font-normal tracking-normal text-fg shadow-lift"
        >
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-[#6366f1] via-[#a855f7] to-[#ec4899] px-4 py-3 text-white">
            <Info className="size-4" aria-hidden />
            <p className="text-sm font-semibold">About {menu?.label ?? 'this screen'}</p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="ml-auto rounded-full p-1 text-white/80 hover:bg-white/20 hover:text-white"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <Section icon={<Lightbulb className="size-4" aria-hidden />} tint="#f59e0b" title="Why">
              <p>{help.why}</p>
            </Section>
            <Section icon={<MapPin className="size-4" aria-hidden />} tint="#0ea5e9" title="Where">
              <p>
                {menu ? (
                  <>
                    Menu: <strong>{menu.group}</strong> → <strong>{menu.label}</strong>.{' '}
                  </>
                ) : null}
                {help.where}
              </p>
            </Section>
            <Section icon={<ListChecks className="size-4" aria-hidden />} tint="#10b981" title="How">
              <ol className="space-y-1">
                {help.how.map((h, n) => (
                  <li key={h} className="flex gap-2">
                    <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-[#10b981]/15 text-[10px] font-bold text-[#059669]">
                      {n + 1}
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ol>
            </Section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ icon, tint, title, children }: { icon: ReactNode; tint: string; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-xl"
        style={{ background: `color-mix(in oklab, ${tint} 15%, transparent)`, color: tint }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: tint }}>
          {title}
        </p>
        <div className="mt-0.5 text-fg-2">{children}</div>
      </div>
    </div>
  );
}
