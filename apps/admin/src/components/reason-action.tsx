'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { reasonAction, type ReasonOp } from '@/app/step4-actions';
import { btn, input } from '@/components/ui';

/** A button that asks for a reason (5 characters or more) before it runs one change. */
export function ReasonAction({
  op,
  label,
  done,
  danger,
  placeholder = 'Reason (kept in the audit log)',
}: {
  op: ReasonOp;
  label: string;
  done: string;
  danger?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button className={danger ? `${btn.ghost} text-danger` : btn.ghost} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="flex min-w-64 items-center gap-1.5">
      <input
        className={`${input} py-1 text-[12px]`}
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        maxLength={500}
      />
      <button
        className={btn.secondary}
        disabled={pending || reason.trim().length < 5}
        onClick={() =>
          start(async () => {
            const r = await reasonAction(op, reason.trim());
            if (!r.ok) return void toast.error(r.error);
            toast.success(done);
            setOpen(false);
            setReason('');
          })
        }
      >
        {label}
      </button>
      <button className={btn.ghost} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
