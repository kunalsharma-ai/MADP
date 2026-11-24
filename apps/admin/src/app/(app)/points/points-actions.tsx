'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { holdReleaseAction, pointsDecideAction } from '@/app/panel-actions';
import { btn } from '@/components/ui';

export function DecideButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const go = (d: 'approve' | 'reject') =>
    start(async () => {
      const r = await pointsDecideAction(id, d);
      if (!r.ok) return void toast.error(r.error);
      toast.success(d === 'approve' ? 'Approved: the points are on the ledger' : 'Rejected');
    });
  return (
    <div className="flex gap-1">
      <button className={btn.ghost} disabled={pending} onClick={() => go('approve')}>
        Approve
      </button>
      <button className={btn.ghost} disabled={pending} onClick={() => go('reject')}>
        Reject
      </button>
    </div>
  );
}

export function ReleaseHold({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={btn.ghost}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await holdReleaseAction(id, 'Checked by the quality team');
          if (!r.ok) return void toast.error(r.error);
          toast.success('Hold released');
        })
      }
    >
      Release
    </button>
  );
}
