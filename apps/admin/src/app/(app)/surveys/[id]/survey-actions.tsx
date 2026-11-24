'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  reconcileAction,
  surveyFeasibilityAction,
  surveyInviteAction,
  surveyStatusAction,
} from '@/app/panel-actions';
import { Badge, Card, CardHeader, EmptyState, Table, btn, fmt, fmtDate, input } from '@/components/ui';

export interface ResponseRow {
  id: string;
  member: string;
  memberName: string | null;
  status: string;
  points: number;
  updatedAt: string;
}
const MOVES: Record<string, [string, string][]> = {
  draft: [
    ['active', 'Go live'],
    ['closed', 'Close'],
  ],
  active: [
    ['paused', 'Pause'],
    ['closed', 'Close'],
  ],
  paused: [
    ['active', 'Resume'],
    ['closed', 'Close'],
  ],
  closed: [],
};

export function StatusButtons({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <>
      {(MOVES[status] ?? []).map(([to, label]) => (
        <button
          key={to}
          className={to === 'active' ? btn.primary : btn.secondary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await surveyStatusAction(id, to);
              if (!r.ok) return void toast.error(r.error);
              toast.success(`Survey ${label.toLowerCase()}`);
            })
          }
        >
          {label}
        </button>
      ))}
    </>
  );
}

export function Invite({
  id,
  status,
  audiences,
}: {
  id: string;
  status: string;
  audiences: { id: string; name: string; lastCount: number | null }[];
}) {
  const [pending, start] = useTransition();
  const [audience, setAudience] = useState('');
  const [feas, setFeas] = useState<{ eligible: number; alreadyInvited: number; wouldInvite: number } | null>(
    null,
  );
  const [dry, setDry] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const check = () =>
    start(async () => {
      const [f, d] = await Promise.all([
        surveyFeasibilityAction(id, audience || undefined),
        surveyInviteAction(id, true, audience || undefined),
      ]);
      if (!f.ok) return void toast.error(f.error);
      if (!d.ok) return void toast.error(d.error);
      setFeas(f.data);
      setDry(d.data.wouldInvite ?? 0);
    });
  const send = () =>
    start(async () => {
      const r = await surveyInviteAction(id, false, audience || undefined, reason);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${fmt(r.data.invited ?? 0)} members invited. No e-mail was sent.`);
      setDry(null);
      setReason('');
    });
  return (
    <Card>
      <CardHeader
        title="Invite members"
        hint="Members of the survey's segment who meet its minimum quality score and premium conditions, narrowed by a saved audience if you pick one. Nobody is invited twice."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${input} max-w-xs`}
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value);
              setDry(null);
            }}
          >
            <option value="">Whole segment</option>
            {audiences.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({fmt(a.lastCount)})
              </option>
            ))}
          </select>
          <button className={btn.secondary} disabled={pending} onClick={check}>
            Dry run
          </button>
          {feas ? (
            <span>
              {fmt(feas.eligible)} eligible, {fmt(feas.alreadyInvited)} already invited,{' '}
              <strong>{fmt(dry)}</strong> would be invited now.
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${input} max-w-md`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason, needed to invite for real"
          />
          <button
            className={btn.primary}
            disabled={pending || dry === null || dry === 0 || status !== 'active' || reason.trim().length < 5}
            onClick={send}
          >
            Invite {dry ? fmt(dry) : ''}
          </button>
          {status !== 'active' ? <span className="text-fg-3">Only a live survey can invite.</span> : null}
        </div>
      </div>
    </Card>
  );
}

export function Reconcile({ id, rows }: { id: string; rows: ResponseRow[] }) {
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<Record<string, 'approve' | 'reject'>>({});
  const [reason, setReason] = useState('');
  const approve = Object.keys(pick).filter((k) => pick[k] === 'approve');
  const reject = Object.keys(pick).filter((k) => pick[k] === 'reject');
  const toggle = (rid: string, v: 'approve' | 'reject') =>
    setPick((p) => {
      const n = { ...p };
      if (n[rid] === v) delete n[rid];
      else n[rid] = v;
      return n;
    });
  const go = () =>
    start(async () => {
      const r = await reconcileAction(id, approve, reject, reason);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        `${r.data.approved} approved, ${r.data.rejected} rejected${r.data.skipped ? `, ${r.data.skipped} skipped` : ''}`,
      );
      setPick({});
      setReason('');
    });
  if (!rows.length) return <EmptyState title="No responses here yet" />;
  return (
    <>
      <Table head={['Member', 'Status', 'Points', 'Updated', 'Reconcile']}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-5 py-2.5">
              {r.memberName ?? '—'} <span className="font-mono text-[11px] text-fg-3">{r.member}</span>
            </td>
            <td className="px-5 py-2.5">
              <Badge tone={r.status === 'complete' ? 'teal' : r.status === 'rejected' ? 'danger' : 'neutral'}>
                {r.status}
              </Badge>
            </td>
            <td className="num px-5 py-2.5">{fmt(r.points)}</td>
            <td className="px-5 py-2.5">{fmtDate(r.updatedAt)}</td>
            <td className="px-5 py-2.5">
              {r.status === 'dropout' || r.status === 'invited' ? (
                <button
                  className={`${btn.ghost} ${pick[r.id] === 'approve' ? 'bg-teal-soft text-teal' : ''}`}
                  onClick={() => toggle(r.id, 'approve')}
                >
                  Approve
                </button>
              ) : null}
              {r.status === 'complete' ? (
                <button
                  className={`${btn.ghost} ${pick[r.id] === 'reject' ? 'bg-danger-soft text-danger' : ''}`}
                  onClick={() => toggle(r.id, 'reject')}
                >
                  Reject
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 text-[13px]">
        <span>
          {approve.length} to approve, {reject.length} to reject
        </span>
        <input
          className={`${input} max-w-md`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason, for example the client's final list"
        />
        <button
          className={btn.primary}
          disabled={pending || (!approve.length && !reject.length) || reason.trim().length < 5}
          onClick={go}
        >
          Reconcile
        </button>
      </div>
    </>
  );
}
