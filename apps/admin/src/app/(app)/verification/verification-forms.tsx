'use client';
import { panelName, panelShort } from '@/lib/panel-names';
import { usePanels } from '@/components/panels-context';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { VERIFICATION_CLAIMS, VERIFICATION_METHODS } from '@madp/contracts';
import { evidenceStepAction, recordEvidenceAction } from '../../actions';
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

const label = (s: string) => s.replaceAll('_', ' ');

export function NewEvidence() {
  const panelList = usePanels();
  const { pending, act } = useAct();
  return (
    <Card>
      <CardHeader
        title="Record a verification check"
        hint="For a check you carried out yourself, such as a licence registry lookup. The reference says where the proof is kept, with no personal data."
      />
      <form
        className="grid gap-3 px-5 py-4 md:grid-cols-6"
        action={(f) =>
          act(() =>
            recordEvidenceAction({
              personId: String(f.get('person')).trim(),
              panel: String(f.get('panel')),
              claim: String(f.get('claim')),
              method: String(f.get('method')),
              reference: String(f.get('reference')),
              expiresOn: String(f.get('expires') || '') || undefined,
            }),
          )
        }
      >
        <label className="text-[13px] md:col-span-2">
          Person id
          <input name="person" required pattern="[0-9a-fA-F-]{36}" className={input} placeholder="From the panellist profile" />
        </label>
        <label className="text-[13px]">
          Panel
          <select name="panel" className={input}>
            {panelList.map((x) => x.code).map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px]">
          Claim
          <select name="claim" className={input}>
            {VERIFICATION_CLAIMS.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] md:col-span-2">
          Method
          <select name="method" className={input}>
            {VERIFICATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] md:col-span-3">
          Reference (no personal data)
          <input name="reference" required minLength={3} className={input} placeholder="Registry lookup 5521" />
        </label>
        <label className="text-[13px]">
          Proof expires on
          <input name="expires" type="date" className={input} />
        </label>
        <div className="flex items-end md:col-span-2">
          <button className={btn.primary} disabled={pending}>
            Record for review
          </button>
        </div>
      </form>
    </Card>
  );
}

export function EvidenceSteps({ id, status, mine }: { id: string; status: string; mine: boolean }) {
  const { pending, act } = useAct();
  const [note, setNote] = useState('');
  if (status === 'pending' && mine) return <span className="text-[12px] text-fg-3">Waiting for a second reviewer</span>;
  const steps: ['verified' | 'rejected' | 'revoke', string][] =
    status === 'pending' ? [['verified', 'Verify'], ['rejected', 'Reject']] : status === 'verified' ? [['revoke', 'Revoke']] : [];
  if (!steps.length) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the trail"
        aria-label="Note for the trail"
        className={`${input} w-48 py-1 text-[12px]`}
      />
      {steps.map(([step, text]) => (
        <button
          key={step}
          className={step === 'verified' ? btn.secondary : btn.ghost}
          disabled={pending || note.trim().length < 3}
          onClick={() => act(() => evidenceStepAction(id, step, note))}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
