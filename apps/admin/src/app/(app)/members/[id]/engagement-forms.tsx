'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { memberAlertsAction, memberPayoutClearAction, type MemberAlerts } from '@/app/panel-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

const SWITCHES = [
  ['email', 'E-mail alerts'],
  ['whatsapp', 'WhatsApp alerts'],
  ['push', 'Push notifications'],
  ['newSurvey', 'New survey alerts'],
  ['weeklySummary', 'Weekly summary'],
  ['expiryReminders', 'Points expiry reminders'],
  ['lifecycle', 'We-miss-you e-mails'],
  ['birthday', 'Birthday greeting'],
] as const;
type Key = (typeof SWITCHES)[number][0];

/** The member's alert settings, changed the way the member could change them, with a reason for the audit log. */
export function AlertsForm({
  member,
  alerts,
  canEdit,
}: {
  member: string;
  alerts: {
    notifications: Record<string, boolean> & { quietHours?: { enabled: boolean; start: string; end: string } };
    survey: { invitesPerWeek: number | null };
    pushDevices: number;
    whatsappAvailable: boolean;
  };
  canEdit: boolean;
}) {
  const [on, setOn] = useState<Record<Key, boolean>>(
    Object.fromEntries(SWITCHES.map(([k]) => [k, Boolean(alerts.notifications[k])])) as Record<Key, boolean>,
  );
  const q = alerts.notifications.quietHours ?? { enabled: false, start: '22:00', end: '08:00' };
  const [quiet, setQuiet] = useState(q);
  const [perWeek, setPerWeek] = useState(alerts.survey.invitesPerWeek === null ? '' : String(alerts.survey.invitesPerWeek));
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const body: MemberAlerts = {
        notifications: { ...on, quietHours: quiet },
        survey: { invitesPerWeek: perWeek === '' ? null : Math.max(0, Math.min(50, Number(perWeek) || 0)) },
      };
      const r = await memberAlertsAction(member, body, reason);
      if (!r.ok) return void toast.error(r.error);
      toast.success('Alert settings saved');
      setReason('');
    });
  return (
    <Card>
      <CardHeader title="Alerts and contact" hint={`${alerts.pushDevices} device(s) with push turned on`} />
      <div className="grid gap-3 px-5 py-4 text-[13px]">
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SWITCHES.map(([k, label]) => {
            const locked = !canEdit || (k === 'whatsapp' && !alerts.whatsappAvailable);
            return (
              <li key={k}>
                <label className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${locked ? 'opacity-60' : 'hover:bg-surface-2'}`}>
                  <span>
                    {label}
                    {k === 'whatsapp' && !alerts.whatsappAvailable ? <span className="block text-[10.5px] text-fg-3">switched off for this brand</span> : null}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={on[k]}
                    disabled={locked || pending}
                    onChange={(e) => setOn((c) => ({ ...c, [k]: e.target.checked }))}
                    className="size-4 accent-[#6366f1]"
                  />
                </label>
              </li>
            );
          })}
        </ul>
        <fieldset className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2" disabled={!canEdit || pending}>
          <legend className="px-1 text-[12px] text-fg-2">Quiet hours</legend>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={quiet.enabled} onChange={(e) => setQuiet((c) => ({ ...c, enabled: e.target.checked }))} className="accent-[#6366f1]" />
            On
          </label>
          <input type="time" value={quiet.start} onChange={(e) => setQuiet((c) => ({ ...c, start: e.target.value }))} aria-label="Quiet from" className={input} style={{ width: '7.5rem' }} />
          to
          <input type="time" value={quiet.end} onChange={(e) => setQuiet((c) => ({ ...c, end: e.target.value }))} aria-label="Quiet until" className={input} style={{ width: '7.5rem' }} />
        </fieldset>
        <label className="flex items-center gap-2">
          Survey invites a week
          <input
            type="number"
            min={0}
            max={50}
            value={perWeek}
            placeholder="no limit"
            disabled={!canEdit || pending}
            onChange={(e) => setPerWeek(e.target.value)}
            className={input}
            style={{ width: '6.5rem' }}
          />
        </label>
        {canEdit ? (
          <>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (for the audit log)" aria-label="Reason" className={input} />
            <button className={btn.primary} disabled={pending || reason.trim().length < 5} onClick={save}>
              Save alert settings
            </button>
          </>
        ) : (
          <p className="text-[12px] text-fg-3">Only admins who may edit members can change these. Teens are changed from the Teen module.</p>
        )}
      </div>
    </Card>
  );
}

/** Clear the saved payout method, for example after a suspected account takeover. */
export function PayoutClear({ member }: { member: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button className={btn.secondary} onClick={() => setOpen(true)}>
        Clear payout method…
      </button>
    );
  return (
    <div className="grid gap-2 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
      <p className="text-[12px] text-fg-2">
        The member will choose a new method at their next reward request. Rewards already requested keep their destination.
      </p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. suspected takeover, ticket 4411" aria-label="Reason" className={input} />
      <div className="flex gap-2">
        <button
          className={btn.primary}
          disabled={pending || reason.trim().length < 5}
          onClick={() =>
            start(async () => {
              const r = await memberPayoutClearAction(member, reason);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.data.cleared ? `Cleared (${r.data.was})` : 'Nothing was saved');
              setOpen(false);
            })
          }
        >
          Clear it
        </button>
        <button className={btn.ghost} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
