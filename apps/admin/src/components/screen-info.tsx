'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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
  if (!found) return null;
  const { help, key } = found;
  const menu = NAV.flatMap((g) => g.items.map((i) => ({ group: g.label, ...i }))).find((i) => i.href === key);
  return (
    <InfoPopover
      title={`About ${menu?.label ?? 'this screen'}`}
      label="About this screen"
      help={help}
      where={
        menu ? (
          <>
            Menu: <strong>{menu.group}</strong> → <strong>{menu.label}</strong>.{' '}
          </>
        ) : null
      }
      open={open}
      setOpen={setOpen}
      boxRef={box}
      id={id}
    />
  );
}

export interface TopicHelp {
  why: string;
  where: string;
  how: string[];
}

/**
 * A small "i" for one feature or setting inside a screen, with the same Why / Where / How card as the page's own
 * button. `align="right"` opens the card leftwards, for buttons near the right edge.
 */
export function TopicInfo({ title, help, align = 'left', up }: { title: string; help: TopicHelp; align?: 'left' | 'right'; /** Open above the button, e.g. in a bar at the bottom of the screen. */ up?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  return <InfoPopover title={title} label={`About ${title}`} help={help} open={open} setOpen={setOpen} boxRef={box} id={id} small align={align} up={up} />;
}

function InfoPopover({
  title,
  label,
  help,
  where,
  open,
  setOpen,
  boxRef,
  id,
  small,
  align = 'left',
  up,
}: {
  title: string;
  label: string;
  help: TopicHelp;
  where?: ReactNode;
  open: boolean;
  setOpen: (f: (o: boolean) => boolean) => void;
  boxRef: RefObject<HTMLDivElement | null>;
  id: string;
  small?: boolean;
  align?: 'left' | 'right';
  up?: boolean;
}) {
  // Slide the card sideways so it always fits on screen, phones included (16px gutter each side).
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) return setShift(0);
    const b = boxRef.current?.getBoundingClientRect();
    if (!b) return;
    const W = window.innerWidth;
    const w = Math.min(416, W - 32);
    const left = align === 'right' ? b.right - w : b.left;
    setShift(Math.max(16, Math.min(left, W - 16 - w)) - b.left);
  }, [open, align, boxRef]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(() => false);
    const onClick = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(() => false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, setOpen, boxRef]);
  return (
    <div ref={boxRef} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        title="Why, where and how"
        onClick={() => setOpen((o) => !o)}
        className={
          small
            ? 'group relative inline-grid size-5 place-items-center rounded-full bg-gradient-to-br from-[#6366f1] via-[#a855f7] to-[#ec4899] text-white shadow-[0_4px_10px_-4px_rgba(168,85,247,0.8)] transition duration-200 hover:scale-110 hover:rotate-12'
            : 'group relative ml-2.5 inline-grid size-7 place-items-center rounded-full bg-gradient-to-br from-[#6366f1] via-[#a855f7] to-[#ec4899] text-white shadow-[0_6px_16px_-6px_rgba(168,85,247,0.8)] transition duration-200 hover:scale-110 hover:rotate-12'
        }
      >
        {small ? null : <span className="ping-soft absolute inset-0 rounded-full bg-[#a855f7]" style={{ animationIterationCount: 3 }} aria-hidden />}
        <Info className={small ? 'relative size-3' : 'relative size-4'} strokeWidth={2.5} aria-hidden />
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          style={{ left: shift }}
          className={`rise absolute ${up ? 'bottom-7' : small ? 'top-7' : 'top-9'} z-40 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface text-left text-[13px] font-normal normal-case tracking-normal text-fg shadow-lift`}
        >
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-[#6366f1] via-[#a855f7] to-[#ec4899] px-4 py-3 text-white">
            <Info className="size-4" aria-hidden />
            <p className="text-sm font-semibold">{title}</p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(() => false)}
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
                {where}
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
