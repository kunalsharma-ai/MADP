'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { PanelConnectionView } from '@madp/contracts';
import { btn, input } from '@/components/ui';
import { changeConnectionAction, decideConnectionAction, testConnectionAction } from './actions';

const FIELD_LABEL: Record<string, string> = {
  syncBaseUrl: 'sync address',
  syncToken: 'sync token',
  adminBaseUrl: 'admin API address',
  adminSecret: 'admin API secret',
  syncIntervalMinutes: 'sync interval',
  liveApproved: 'live sync',
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/**
 * Edit one panel's connection. Blank secret fields keep the saved value; "Clear" removes the value saved here, so
 * the server setting (if any) applies again. Every save asks for the authenticator code.
 */
export function ConnectionForm({ connection: c }: { connection: PanelConnectionView }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [clear, setClear] = useState<Record<string, boolean>>({});
  if (!open)
    return (
      <div className="border-t border-border px-5 py-3">
        <button className={btn.secondary} onClick={() => setOpen(true)}>
          Edit connection
        </button>
      </div>
    );

  function patch(f: FormData) {
    const out: Record<string, unknown> = {};
    const url = (k: 'syncBaseUrl' | 'adminBaseUrl') => {
      if (clear[k]) out[k] = null;
      else if (str(f, k) && str(f, k) !== (c[k].value ?? '')) out[k] = str(f, k);
    };
    url('syncBaseUrl');
    url('adminBaseUrl');
    for (const k of ['syncToken', 'adminSecret'] as const) {
      if (clear[k]) out[k] = null;
      else if (str(f, k)) out[k] = str(f, k);
    }
    if (clear.syncIntervalMinutes) out.syncIntervalMinutes = null;
    else if (
      str(f, 'syncIntervalMinutes') !== '' &&
      Number(str(f, 'syncIntervalMinutes')) !== c.syncIntervalMinutes.value
    )
      out.syncIntervalMinutes = Number(str(f, 'syncIntervalMinutes'));
    const live = f.get('liveApproved') === 'on';
    if (live !== c.liveApproved.value) out.liveApproved = live;
    return out;
  }

  const ClearBox = ({ k }: { k: string }) => (
    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-3">
      <input
        type="checkbox"
        checked={!!clear[k]}
        onChange={(e) => setClear({ ...clear, [k]: e.target.checked })}
      />
      Clear the value saved here
    </label>
  );

  return (
    <form
      className="grid gap-3 border-t border-border px-5 py-4 text-[13px]"
      action={(f) =>
        start(async () => {
          const changes = patch(f);
          if (!Object.keys(changes).length) {
            toast.error('Nothing changed');
            return;
          }
          if (
            changes.liveApproved === true &&
            !window.confirm(
              `Turn on live sync for ${c.name}? This is your approval for MADP to read this panel's real member data.`,
            )
          )
            return;
          try {
            const r = await changeConnectionAction(c.panel, {
              ...changes,
              reason: str(f, 'reason'),
              code: str(f, 'code'),
            });
            toast.success(
              r.status === 'pending'
                ? 'Saved for approval. Another Super Admin approves it on this screen.'
                : 'Saved. MADP uses the new settings now.',
            );
            setOpen(false);
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      <label>
        Sync address (the panel&apos;s website, e.g. https://www.myfrequentrewards.com)
        <input name="syncBaseUrl" type="url" defaultValue={c.syncBaseUrl.value ?? ''} className={input} />
        <ClearBox k="syncBaseUrl" />
      </label>
      <label>
        Sync token (from the panel&apos;s admin integration account)
        <input
          name="syncToken"
          type="password"
          autoComplete="off"
          placeholder={
            c.syncToken.set ? `Saved (${c.syncToken.hint}). Leave blank to keep it.` : 'Paste the token'
          }
          className={input}
        />
        <ClearBox k="syncToken" />
      </label>
      <button
        type="button"
        disabled={pending}
        className={btn.ghost}
        onClick={(e) =>
          start(async () => {
            const f = new FormData(e.currentTarget.form!);
            try {
              const r = await testConnectionAction(c.panel, {
                ...(str(f, 'syncBaseUrl') ? { syncBaseUrl: str(f, 'syncBaseUrl') } : {}),
                ...(str(f, 'syncToken') ? { syncToken: str(f, 'syncToken') } : {}),
              });
              if (r.ok) toast.success(r.message);
              else toast.error(r.message);
            } catch (err) {
              toast.error((err as Error).message);
            }
          })
        }
      >
        Test connection
      </button>
      <label>
        Admin API address (the shared panel backend)
        <input name="adminBaseUrl" type="url" defaultValue={c.adminBaseUrl.value ?? ''} className={input} />
        <ClearBox k="adminBaseUrl" />
      </label>
      <label>
        Admin API secret (the same value as the panel&apos;s MADP_ADMIN_API_SECRETS)
        <input
          name="adminSecret"
          type="password"
          autoComplete="off"
          placeholder={
            c.adminSecret.set ? `Saved (${c.adminSecret.hint}). Leave blank to keep it.` : 'Paste the secret'
          }
          className={input}
        />
        <ClearBox k="adminSecret" />
      </label>
      <label>
        Automatic sync every (minutes, 0 is off)
        <input
          name="syncIntervalMinutes"
          type="number"
          min={0}
          max={1440}
          defaultValue={c.syncIntervalMinutes.value}
          className={input}
        />
        <ClearBox k="syncIntervalMinutes" />
      </label>
      <label className="flex items-center gap-2">
        <input name="liveApproved" type="checkbox" defaultChecked={c.liveApproved.value} />
        Live sync: read this panel&apos;s real member data (off means DEMO data only)
      </label>
      <label>
        Reason
        <input name="reason" required minLength={5} className={input} />
      </label>
      <label>
        Authenticator code (a new code: one you have not just used to sign in)
        <input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} className={input} />
      </label>
      <div className="flex gap-2">
        <button className={btn.primary} disabled={pending}>
          Save
        </button>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A change waiting for a second Super Admin. The proposer can only reject (withdraw) it. */
export function PendingDecision({ connection: c }: { connection: PanelConnectionView }) {
  const [pending, start] = useTransition();
  const p = c.pending!;
  return (
    <form
      className="grid gap-2 border-t border-border bg-warn-soft/40 px-5 py-4 text-[13px]"
      action={(f) =>
        start(async () => {
          try {
            const decision = (f.get('decision') as 'approve' | 'reject') ?? 'approve';
            await decideConnectionAction(c.panel, {
              decision,
              reason: str(f, 'reason'),
              code: str(f, 'code'),
            });
            toast.success(decision === 'approve' ? 'Approved. MADP uses the new settings now.' : 'Rejected');
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      <p>
        <strong>Waiting for approval:</strong> {p.byName ?? 'An admin'} wants to change the{' '}
        {p.fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}. Reason: {p.reason}
      </p>
      {c.canChange ? (
        <>
          <input name="reason" required minLength={5} placeholder="Your reason" className={input} />
          <input
            name="code"
            required
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="Authenticator code"
            className={input}
          />
          <div className="flex gap-2">
            <button name="decision" value="approve" className={btn.primary} disabled={pending}>
              Approve
            </button>
            <button name="decision" value="reject" className={btn.secondary} disabled={pending}>
              Reject
            </button>
          </div>
        </>
      ) : null}
    </form>
  );
}
