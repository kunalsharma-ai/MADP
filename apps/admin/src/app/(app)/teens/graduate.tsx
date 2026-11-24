'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { graduatePreviewAction, reasonAction } from '@/app/step4-actions';
import { btn, input } from '@/components/ui';

/** Turning 18: shows the dry run first, then asks for a reason before the move. */
export function Graduate({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState<{
    age: number;
    guardianLinksToStop: number;
    rewardRequestsToCancel: number;
  } | null>(null);
  const [reason, setReason] = useState('');
  if (!plan)
    return (
      <button
        className={btn.ghost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await graduatePreviewAction(id);
            if (!r.ok) return void toast.error(r.error);
            setPlan(r.data);
          })
        }
      >
        Move to adult account
      </button>
    );
  return (
    <div className="grid min-w-72 gap-1.5 text-[12px]">
      <p className="text-fg-2">
        Age {plan.age}. Moves to Consumer (b2c); answers and points stay. Stops {plan.guardianLinksToStop}{' '}
        guardian link(s) and cancels {plan.rewardRequestsToCancel} reward request(s) waiting for the guardian.
      </p>
      <div className="flex gap-1.5">
        <input
          className={`${input} py-1 text-[12px]`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason, e.g. DOB checked"
        />
        <button
          className={btn.secondary}
          disabled={pending || reason.trim().length < 5}
          onClick={() =>
            start(async () => {
              const r = await reasonAction({ op: 'teen-graduate', id }, reason.trim());
              if (!r.ok) return void toast.error(r.error);
              toast.success('Moved to an adult account');
              setPlan(null);
            })
          }
        >
          Move
        </button>
        <button className={btn.ghost} onClick={() => setPlan(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
