'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { CONTACT_CHANNELS, PREFERENCE_SOURCES } from '@madp/contracts';
import { recordPreferenceAction } from '../../actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

export function PreferenceForm({ panels }: { panels: string[] }) {
  const [pending, start] = useTransition();
  return (
    <Card className="mt-4">
      <CardHeader
        title="Record a member's request"
        hint="Opt a member out of a channel, or lift an opt-out MADP recorded. Consent itself can only be given at the panel."
      />
      <form
        className="grid gap-3 px-5 py-4 md:grid-cols-6"
        action={(f) =>
          start(async () => {
            try {
              toast.success(
                await recordPreferenceAction(String(f.get('person')).trim(), {
                  panel: String(f.get('panel')),
                  channel: String(f.get('channel')),
                  status: String(f.get('status')),
                  source: String(f.get('source')),
                  reason: String(f.get('reason')),
                }),
              );
            } catch (e) {
              toast.error((e as Error).message);
            }
          })
        }
      >
        <label className="text-[13px] md:col-span-2">
          Person id
          <input name="person" required pattern="[0-9a-fA-F-]{36}" className={input} placeholder="From the panellist profile" />
        </label>
        <label className="text-[13px]">
          Panel
          <select name="panel" className={input}>
            {panels.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px]">
          Channel
          <select name="channel" className={input}>
            {CONTACT_CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px]">
          Request
          <select name="status" className={input}>
            <option value="opted_out">Opt out</option>
            <option value="resumed">Lift MADP opt-out</option>
          </select>
        </label>
        <label className="text-[13px]">
          Came from
          <select name="source" className={input}>
            {PREFERENCE_SOURCES.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] md:col-span-5">
          Reference (no personal data)
          <input name="reason" required minLength={3} maxLength={300} className={input} placeholder="Ticket 4411" />
        </label>
        <div className="flex items-end">
          <button className={btn.primary} disabled={pending}>
            Record
          </button>
        </div>
      </form>
    </Card>
  );
}
