'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { ArrowRight } from 'lucide-react';
import { setBrand } from '@/app/super-admin-actions';
import { BrandLogo } from './brand-logo';

/** One big button per brand; a click switches the brand and reloads the screen. */
export function BrandPicker({ panels }: { panels: { code: string; name: string; shortName: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="mx-auto mt-5 grid max-w-2xl gap-3 sm:grid-cols-3">
      {panels.map((p) => (
        <button
          key={p.code}
          disabled={pending}
          onClick={() => start(async () => {
            await setBrand(p.code);
            router.refresh();
          })}
          className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-4 shadow-soft transition hover:-translate-y-1 hover:border-accent/40 hover:shadow-lift disabled:opacity-60"
        >
          <BrandLogo panel={p.code} label={p.shortName} size={48} />
          <span className="text-[13px] font-semibold text-fg">{p.name}</span>
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent">
            Open <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}
