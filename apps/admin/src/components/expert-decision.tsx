'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { expertDecisionAction } from '@/app/expert-actions';
import { btn, input } from '@/components/ui';

/**
 * Verify or decline a waiting request. Both need a reason for the audit log; declining also needs a short note that
 * the member sees on their expertise page. Nothing is e-mailed.
 */
export function ExpertDecision({ id, canVerify }: { id: string; canVerify: boolean }) {
  const [mode, setMode] = useState<'closed' | 'verified' | 'declined'>('closed');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  if (mode === 'closed')
    return (
      <div className="flex flex-wrap gap-1">
        {canVerify ? (
          <button className={btn.secondary} onClick={() => setMode('verified')}>
            Verify
          </button>
        ) : null}
        <button className={`${btn.ghost} text-danger`} onClick={() => setMode('declined')}>
          Decline
        </button>
      </div>
    );
  const ok = reason.trim().length >= 5 && (mode === 'verified' || note.trim().length >= 5);
  return (
    <div className="flex min-w-72 flex-col gap-1.5">
      {mode === 'declined' ? (
        <input
          className={`${input} py-1 text-[12px]`}
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note to the member (they see this)"
          maxLength={300}
        />
      ) : null}
      <input
        className={`${input} py-1 text-[12px]`}
        autoFocus={mode === 'verified'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (kept in the audit log)"
        maxLength={500}
      />
      <div className="flex gap-1.5">
        <button
          className={mode === 'verified' ? btn.primary : btn.secondary}
          disabled={pending || !ok}
          onClick={() =>
            start(async () => {
              const r = await expertDecisionAction(
                id,
                mode,
                reason.trim(),
                mode === 'declined' ? note.trim() : undefined,
              );
              if (!r.ok) return void toast.error(r.error);
              toast.success(mode === 'verified' ? 'Verified' : 'Declined');
              setMode('closed');
            })
          }
        >
          {mode === 'verified' ? 'Verify' : 'Decline'}
        </button>
        <button className={btn.ghost} onClick={() => setMode('closed')}>
          Cancel
        </button>
      </div>
    </div>
  );
}
