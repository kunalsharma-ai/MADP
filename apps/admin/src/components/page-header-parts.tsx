'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { NAV } from './nav';
import { ICONS, tintFor } from './nav-icons';
import { helpFor } from '@/lib/screen-help';
import { cn } from '@/lib/cn';

/** The screen's own menu icon on a coloured tile, beside the page title. */
export function ScreenIcon() {
  const path = usePathname();
  const key = helpFor(path)?.key;
  const item = NAV.flatMap((g) => g.items).find((i) => i.href === key);
  if (!item) return null;
  const Icon = ICONS[item.icon as keyof typeof ICONS];
  const [from, to] = tintFor(item.href);
  return (
    <span
      className="hidden size-12 shrink-0 place-items-center rounded-2xl text-white sm:grid"
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})`, boxShadow: `0 12px 24px -12px ${to}` }}
      aria-hidden
    >
      <Icon className="size-6" />
    </span>
  );
}

/** A page description kept to two lines, with "Read more" when it is longer. */
export function ShortDescription({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [children]);
  return (
    <div className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-fg-2">
      <div ref={ref} className={cn(!open && 'line-clamp-2')}>
        {children}
      </div>
      {long || open ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline"
          aria-expanded={open}
        >
          {open ? 'Show less' : 'Read more'}
          <ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
