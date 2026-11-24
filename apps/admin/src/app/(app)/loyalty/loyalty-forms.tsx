'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { approveSurveyAction, loyaltyAction } from '../../actions';
import { btn } from '@/components/ui';

function useAct() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        const r = await fn();
        toast.success(typeof r === 'string' ? r : 'Done');
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, act };
}

export function PanelButtons({ panel, canRun }: { panel: string; canRun: boolean }) {
  const { pending, act } = useAct();
  if (!canRun) return null;
  return (
    <span className="flex gap-1">
      <button className={btn.ghost} disabled={pending} onClick={() => act(() => loyaltyAction(panel, 'sync'))}>
        Update mirror
      </button>
      <button className={btn.secondary} disabled={pending} onClick={() => act(() => loyaltyAction(panel, 'reconcile'))}>
        Reconcile
      </button>
      <button className={btn.ghost} disabled={pending} onClick={() => act(() => loyaltyAction(panel, 'repair'))}>
        Reconcile and repair
      </button>
    </span>
  );
}

export function ApproveSurvey({ panel, survey }: { panel: string; survey: string }) {
  const { pending, act } = useAct();
  return (
    <form
      className="flex items-center gap-1"
      action={(f) => act(() => approveSurveyAction(panel, survey, String(f.get('note'))))}
    >
      <input
        name="note"
        required
        minLength={3}
        placeholder="Client sign-off reference"
        aria-label={`Approval note for ${survey}`}
        className="rounded-md border border-border bg-surface px-2 py-1 text-[12px]"
      />
      <button className={btn.primary} disabled={pending}>
        Approve
      </button>
    </form>
  );
}
