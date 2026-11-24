'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { reasonAction } from '@/app/step4-actions';
import { btn, input } from '@/components/ui';
import { Toggle, ToggleLabel } from '@/components/toggle';

interface Valued {
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number | null;
}

/**
 * Change one switch for the whole brand or for the segment/country picked at the top of the page. Asks for a reason
 * (5 characters or more). A switch with a number (hold days, multiplier) can set it in the same step.
 */
export function SwitchControl({
  k,
  on,
  segment,
  country,
  valued,
  value,
  scopeLabel,
  onText = 'On',
  offText = 'Off',
}: {
  k: string;
  on: boolean;
  segment?: string;
  country?: string;
  valued?: Valued | null;
  value?: number | null;
  scopeLabel: string;
  onText?: string;
  offText?: string;
}) {
  const [mode, setMode] = useState<'closed' | 'flip' | 'number'>('closed');
  const [reason, setReason] = useState('');
  const [num, setNum] = useState(String(value ?? valued?.default ?? ''));
  const [pending, start] = useTransition();
  const scope = { ...(segment ? { segment } : {}), ...(country ? { country } : {}) };
  if (mode === 'closed')
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          on={on}
          label={`${on ? 'Turn off' : 'Turn on'} for ${scopeLabel}`}
          onClick={() => setMode('flip')}
        />
        <ToggleLabel on={on} onText={onText} offText={offText} />
        {valued ? (
          <button className={btn.ghost} onClick={() => setMode('number')}>
            Set {valued.unit === 'x' ? 'multiplier' : valued.unit}
          </button>
        ) : null}
      </div>
    );
  const n = Number(num);
  const numOk = !valued || mode !== 'number' || (num !== '' && n >= valued.min && n <= valued.max);
  const turningOn = mode === 'flip' ? !on : true;
  return (
    <div className="flex min-w-72 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Toggle on={turningOn} label="Cancel this change" pending onClick={() => setMode('closed')} />
        <p className="text-[11.5px] text-fg-3">
          {mode === 'flip' ? (turningOn ? 'Turn on' : 'Turn off') : 'Set the number'} for {scopeLabel}: give a
          reason to save
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {valued && (mode === 'number' || turningOn) ? (
          <label className="flex shrink-0 items-center gap-1 text-[12px] text-fg-2">
            <input
              className={`${input} py-1 text-[12px]`}
              style={{ width: '5rem' }}
              value={num}
              onChange={(e) => setNum(e.target.value)}
              inputMode="decimal"
              aria-label={`Number (${valued.unit})`}
            />
            {valued.unit}
          </label>
        ) : null}
        <input
          className={`${input} py-1 text-[12px]`}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (kept in the audit log)"
          maxLength={500}
        />
      </div>
      {valued && !numOk ? (
        <p className="text-[11.5px] text-danger">
          From {valued.min} to {valued.max} {valued.unit}
        </p>
      ) : null}
      <div className="flex gap-1.5">
        <button
          className={btn.secondary}
          disabled={pending || reason.trim().length < 5 || !numOk}
          onClick={() =>
            start(async () => {
              const r = await reasonAction(
                {
                  op: 'switch',
                  key: k,
                  on: turningOn,
                  ...scope,
                  ...(valued && (mode === 'number' || turningOn) && num !== '' ? { value: n } : {}),
                },
                reason.trim(),
              );
              if (!r.ok) return void toast.error(r.error);
              toast.success('Switch changed');
              setMode('closed');
              setReason('');
            })
          }
        >
          Save
        </button>
        <button className={btn.ghost} onClick={() => setMode('closed')}>
          Cancel
        </button>
      </div>
    </div>
  );
}
