'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { decideInsightAction, refreshInsightsAction } from '../../actions';
import { btn, input } from '@/components/ui';

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
    <button className={btn.secondary} disabled={pending} onClick={() => act(refreshInsightsAction)}>
      {pending ? 'Running rules…' : 'Refresh'}
    </button>
  );
}

export function InsightDecide({ id }: { id: string }) {
  const { pending, act } = useAct();
  const [note, setNote] = useState('');
  const ok = note.trim().length >= 3;
  return (
    <div className="flex w-64 flex-col gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What will you do, or why not?"
        aria-label="Decision note"
        className={`${input} py-1.5 text-[12px]`}
      />
      <div className="flex gap-2">
        <button className={btn.primary} disabled={pending || !ok} onClick={() => act(() => decideInsightAction(id, 'accepted', note))}>
          Accept
        </button>
        <button className={btn.ghost} disabled={pending || !ok} onClick={() => act(() => decideInsightAction(id, 'dismissed', note))}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
