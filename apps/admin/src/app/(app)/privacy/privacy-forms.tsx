'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { PRIVACY_KINDS } from '@madp/contracts';
import { createPrivacyRequestAction, privacyStepAction, purgeRetentionAction } from '../../actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

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

export function NewRequest() {
  const { pending, act } = useAct();
  return (
    <Card>
      <CardHeader title="Log a request" hint="Use the person id from the panellist profile and a reference with no personal data." />
      <form
        className="grid gap-3 px-5 py-4 md:grid-cols-6"
        action={(f) =>
          act(() =>
            createPrivacyRequestAction({
              personId: String(f.get('person')).trim(),
              kind: String(f.get('kind')),
              reference: String(f.get('reference')),
              jurisdiction: String(f.get('jurisdiction') || '') || undefined,
              dueInDays: Number(f.get('due') || 30),
            }),
          )
        }
      >
        <label className="text-[13px] md:col-span-2">
          Person id
          <input name="person" required pattern="[0-9a-fA-F-]{36}" className={input} />
        </label>
        <label className="text-[13px]">
          Kind
          <select name="kind" className={input}>
            {PRIVACY_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px]">
          Reference
          <input name="reference" required minLength={3} className={input} placeholder="Ticket 901" />
        </label>
        <label className="text-[13px]">
          Jurisdiction
          <input name="jurisdiction" className={input} placeholder="Set by counsel" />
        </label>
        <label className="text-[13px]">
          Days to respond
          <input name="due" type="number" min={1} max={90} defaultValue={30} className={input} />
        </label>
        <div className="md:col-span-6">
          <button className={btn.primary} disabled={pending}>
            Log request
          </button>
        </div>
      </form>
    </Card>
  );
}

export function RequestSteps({ id, kind, status }: { id: string; kind: string; status: string }) {
  const { pending, act } = useAct();
  const steps: ['verify' | 'execute' | 'reject' | 'complete', string][] = [];
  if (status === 'received') steps.push(['verify', 'Verify requester'], ['reject', 'Reject']);
  if (status === 'verified') steps.push(['execute', kind === 'deletion' ? 'Erase in MADP' : 'Carry out'], ['reject', 'Reject']);
  if (status === 'awaiting_panel' && kind === 'correction') steps.push(['complete', 'Panel corrected it']);
  return (
    <div className="flex flex-col items-end gap-1">
      {steps.length ? (
        <form
          className="flex flex-wrap items-center justify-end gap-1"
          action={(f) => act(() => privacyStepAction(id, String(f.get('step')) as 'verify', String(f.get('note'))))}
        >
          <input
            name="note"
            required
            minLength={3}
            maxLength={500}
            aria-label="Note for the trail"
            placeholder="Note for the trail"
            className="rounded-md border border-border bg-surface px-2 py-1 text-[12px]"
          />
          {steps.map(([step, label]) => (
            <button key={step} name="step" value={step} className={step === 'reject' ? btn.ghost : btn.secondary} disabled={pending}>
              {label}
            </button>
          ))}
        </form>
      ) : null}
      {kind === 'access' && (status === 'verified' || status === 'completed') ? (
        <a className={btn.ghost} href={`/privacy/export/${id}`}>
          Download export
        </a>
      ) : null}
    </div>
  );
}

export function PurgeButton({ k }: { k: string }) {
  const { pending, act } = useAct();
  return (
    <button className={btn.ghost} disabled={pending} onClick={() => act(() => purgeRetentionAction(k))}>
      Purge now
    </button>
  );
}
