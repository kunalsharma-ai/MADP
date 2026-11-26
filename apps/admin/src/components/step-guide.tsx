import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

const TONES = [
  'from-indigo-500 to-violet-500',
  'from-pink-500 to-rose-500',
  'from-amber-400 to-orange-500',
  'from-teal-400 to-emerald-500',
  'from-sky-400 to-blue-500',
];

/**
 * A row of numbered, coloured steps that shows how a screen's work flows from start to finish.
 * Each step can be marked done; the first step not done is highlighted as the next one.
 */
export function StepGuide({
  title = 'How it works',
  steps,
  className,
}: {
  title?: string;
  steps: { icon: LucideIcon; title: string; body: ReactNode; done?: boolean }[];
  className?: string;
}) {
  const next = steps.findIndex((s) => !s.done);
  return (
    <section aria-label={title} className={cn('mb-4 rounded-2xl border border-border bg-surface p-4 shadow-soft', className)}>
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-fg-3">{title}</h2>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={cn(
              'relative flex gap-3 rounded-xl p-3',
              i === next ? 'bg-accent-soft ring-1 ring-accent/30' : 'bg-surface-2/60',
            )}
          >
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm',
                TONES[i % TONES.length],
              )}
              aria-hidden
            >
              <s.icon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-fg">
                {i + 1}. {s.title}
                {s.done ? <span className="ml-1.5 text-[11px] font-medium text-teal">done</span> : null}
                {i === next ? <span className="ml-1.5 text-[11px] font-medium text-accent">next</span> : null}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-fg-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
