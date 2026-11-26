'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, EyeOff, RefreshCw } from 'lucide-react';
import { decideInsightAction, refreshInsightsAction } from '../../actions';
import { unwrap } from '@/lib/result';
import { btn, input } from '@/components/ui';
import { cn } from '@/lib/cn';

function useAct() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<string>) =>
    start(async () => {
      try {
        toast.success(await fn());
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, act };
}

export function RefreshInsights() {
  const { pending, act } = useAct();
  return (
    <button className={btn.primary} disabled={pending} onClick={() => act(() => unwrap(refreshInsightsAction()))}>
      <RefreshCw className={cn('size-4', pending && 'animate-spin')} aria-hidden />
      {pending ? 'Checking…' : 'Check again'}
    </button>
  );
}

/** Two plain choices. The short note is asked only after a choice, so the card stays simple. */
export function InsightDecide({ id }: { id: string }) {
  const { pending, act } = useAct();
  const [choice, setChoice] = useState<'accepted' | 'dismissed' | null>(null);
  const [note, setNote] = useState('');
  const ok = note.trim().length >= 3;
  if (!choice)
    return (
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#10b981]/30 bg-[#10b981]/10 px-3 py-2 text-[13px] font-semibold text-[#047857] transition hover:bg-[#10b981]/20 dark:text-[#34d399]"
          onClick={() => setChoice('accepted')}
        >
          <CheckCircle2 className="size-4" aria-hidden /> I&apos;ll handle it
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-fg-2 transition hover:bg-surface-2"
          onClick={() => setChoice('dismissed')}
        >
          <EyeOff className="size-4" aria-hidden /> Not needed
        </button>
      </div>
    );
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) act(() => unwrap(decideInsightAction(id, choice, note)));
      }}
    >
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={choice === 'accepted' ? 'What will you do? e.g. "Send a profile reminder Monday"' : 'Why is it not needed?'}
        aria-label="Short note"
        className={`${input} min-w-0 flex-1 py-2 text-[13px]`}
      />
      <button className={btn.primary} disabled={pending || !ok}>
        Save
      </button>
      <button type="button" className={btn.ghost} onClick={() => setChoice(null)}>
        Cancel
      </button>
    </form>
  );
}
