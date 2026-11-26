'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Info, X } from 'lucide-react';
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
        onClick={() => setOpen((o) => !o)}
        className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-fg-3 transition hover:bg-surface-2 hover:text-fg"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label="About this screen"
          className="absolute left-0 top-8 z-30 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 text-[13px] font-normal tracking-normal text-fg shadow-lg"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute right-2 top-2 rounded p-1 text-fg-3 hover:bg-surface-2"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-3">Why</p>
          <p className="mt-0.5">{help.why}</p>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-3">Where</p>
          <p className="mt-0.5">
            {menu ? (
              <>
                Menu: {menu.group} → {menu.label}.{' '}
              </>
            ) : null}
            {help.where}
          </p>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-3">How</p>
          <ol className="mt-0.5 list-decimal space-y-0.5 pl-5">
            {help.how.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
