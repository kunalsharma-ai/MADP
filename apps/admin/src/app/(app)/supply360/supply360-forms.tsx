'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ServiceScope } from '@madp/contracts';
import { createServiceClientAction, revokeServiceClientAction } from '../../actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

const SCOPES = ServiceScope.options;

export function CreateClient({ panels }: { panels: string[] }) {
  const [pending, start] = useTransition();
  const [issued, setIssued] = useState<{ clientId: string; secret: string } | null>(null);
  return (
    <Card>
      <CardHeader title="New service client" hint="Health counts need the health.aggregate scope and are for study feasibility only." />
      <form
        className="grid gap-3 px-5 py-4 md:grid-cols-2"
        action={(f) =>
          start(async () => {
            try {
              const r = await createServiceClientAction({
                name: String(f.get('name')),
                scopes: f.getAll('scopes').map(String),
                panels: f.getAll('panels').map(String),
                rateLimitPerMinute: Number(f.get('rate') || 120),
              });
              setIssued(r);
              toast.success('Client created');
            } catch (e) {
              toast.error((e as Error).message);
            }
          })
        }
      >
        <label className="text-[13px]">
          Name
          <input name="name" required minLength={2} maxLength={120} className={input} placeholder="Supply360 production" />
        </label>
        <label className="text-[13px]">
          Requests a minute
          <input name="rate" type="number" min={1} max={6000} defaultValue={120} className={input} />
        </label>
        <fieldset className="text-[13px]">
          <legend className="mb-1">Panels</legend>
          <div className="flex flex-wrap gap-3">
            {panels.map((p) => (
              <label key={p} className="flex items-center gap-1">
                <input type="checkbox" name="panels" value={p} defaultChecked /> {p.toUpperCase()}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="text-[13px]">
          <legend className="mb-1">Scopes</legend>
          <div className="flex flex-wrap gap-3">
            {SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1 font-mono text-[12px]">
                <input type="checkbox" name="scopes" value={s} defaultChecked={s !== 'health.aggregate'} /> {s}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-2">
          <button className={btn.primary} disabled={pending}>
            Create client
          </button>
        </div>
      </form>
      {issued ? (
        <div className="mx-5 mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px]" role="status">
          <p className="font-medium">Copy this secret now. It is not shown again.</p>
          <p className="mt-1">
            Client id <code className="font-mono">{issued.clientId}</code>
          </p>
          <p className="break-all">
            Secret <code className="font-mono">{issued.secret}</code>
          </p>
          <button className={`${btn.ghost} mt-1`} onClick={() => setIssued(null)}>
            I have stored it
          </button>
        </div>
      ) : null}
    </Card>
  );
}

export function RevokeClient({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);
  if (!sure)
    return (
      <button className={btn.ghost} onClick={() => setSure(true)}>
        Revoke
      </button>
    );
  return (
    <span className="flex items-center justify-end gap-1 text-[12px]">
      Revoke {name}?
      <button
        className={btn.secondary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              toast.success(await revokeServiceClientAction(id));
            } catch (e) {
              toast.error((e as Error).message);
            }
          })
        }
      >
        Yes, revoke
      </button>
      <button className={btn.ghost} onClick={() => setSure(false)}>
        Cancel
      </button>
    </span>
  );
}
