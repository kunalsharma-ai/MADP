'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { mergeAction, mergeUndoAction, type MergeReport } from '@/app/panel-actions';
import { Badge, Card, CardHeader, btn, fmt, input } from '@/components/ui';
import type { MemberRow } from '../shared';

const day = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

/**
 * One group of likely duplicates. Pick the account to keep and the one to close, run the dry run, then merge with a
 * reason. The Merge button exists only for the pair the dry run was for, and only when it found no blockers.
 */
export function MergeGroup({ n, members }: { n: number; members: MemberRow[] }) {
  const [pending, start] = useTransition();
  const [keep, setKeep] = useState(members[0]!.id);
  const [dup, setDup] = useState(members[1]!.id);
  const [report, setReport] = useState<MergeReport | null>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const forPair = report && report.keep.id === keep && report.duplicate.id === dup ? report : null;
  const pick = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setReport(null);
  };

  return (
    <Card>
      <CardHeader title={`Group ${n}`} hint={`${members.length} accounts`} />
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-3">
            {['Keep', 'Close', 'Member', 'E-mail', 'Phone', 'Segment', 'Status', 'Signed up', 'Last active'].map((h) => (
              <th key={h} scope="col" className="px-5 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b border-border/60">
              <td className="px-5 py-2">
                <input type="radio" name={`keep-${n}`} aria-label={`Keep ${m.name}`} checked={keep === m.id} onChange={() => pick(setKeep)(m.id)} />
              </td>
              <td className="px-5 py-2">
                <input type="radio" name={`dup-${n}`} aria-label={`Close ${m.name}`} checked={dup === m.id} onChange={() => pick(setDup)(m.id)} />
              </td>
              <td className="px-5 py-2">
                <Link className="text-accent" href={`/members/${m.id}`}>
                  {m.name || m.memberId || m.id.slice(-6)}
                </Link>
              </td>
              <td className="px-5 py-2">{m.email ?? '—'}</td>
              <td className="px-5 py-2">{m.phone ?? '—'}</td>
              <td className="px-5 py-2">{m.segment}</td>
              <td className="px-5 py-2">{m.status}</td>
              <td className="px-5 py-2">{day(m.signedUpAt)}</td>
              <td className="px-5 py-2">{day(m.lastActivityAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 px-5 py-4 text-[13px]">
        {done ? (
          <p className="font-medium">Merged. The duplicate is closed; undo it from the Merges list below if needed.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                className={btn.secondary}
                disabled={pending || keep === dup}
                onClick={() =>
                  start(async () => {
                    const r = await mergeAction(keep, dup, false);
                    if (!r.ok) return void toast.error(r.error);
                    setReport(r.data);
                  })
                }
              >
                Dry run
              </button>
              {keep === dup ? <span className="text-fg-3">Pick two different accounts.</span> : null}
            </div>
            {forPair ? (
              <div className="grid gap-2 rounded-lg bg-surface-2 p-3">
                {forPair.blockers.map((b) => (
                  <p key={b.code} role="alert" className="text-danger">
                    Can&apos;t merge: {b.message}
                  </p>
                ))}
                {forPair.warnings.map((w) => (
                  <p key={w} className="text-warn">
                    {w}
                  </p>
                ))}
                <p>
                  Points now: kept {fmt(forPair.points.keep?.available ?? 0)} available, duplicate{' '}
                  {fmt(forPair.points.duplicate?.available ?? 0)} available.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {Object.entries(forPair.collections).map(([k, v]) => (
                    <li key={k}>
                      <Badge>
                        {k}: {v.move} move{v.stay ? `, ${v.stay} stay` : ''}
                      </Badge>
                    </li>
                  ))}
                  {forPair.referrals ? <li><Badge>Referrals: {forPair.referrals} move</Badge></li> : null}
                  {Object.keys(forPair.collections).length === 0 && !forPair.referrals ? <li className="text-fg-3">Nothing to move.</li> : null}
                </ul>
                {forPair.blockers.length === 0 ? (
                  <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                    <label>
                      Reason
                      <input
                        className={input}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="For example: member confirmed both accounts are theirs"
                      />
                    </label>
                    <button
                      className={btn.primary}
                      disabled={pending || reason.trim().length < 5}
                      onClick={() =>
                        start(async () => {
                          const r = await mergeAction(keep, dup, true, reason);
                          if (!r.ok) return void toast.error(r.error);
                          setDone(r.data.mergeId ?? 'done');
                          toast.success('Accounts merged');
                        })
                      }
                    >
                      Merge into the kept account
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

/** Undo one merge: asks for a reason and a second click to confirm. */
export function UndoMerge({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  if (!open)
    return (
      <button className={btn.ghost} onClick={() => setOpen(true)}>
        Undo…
      </button>
    );
  return (
    <div className="grid min-w-64 gap-1.5">
      <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for undoing" aria-label="Reason for undoing" />
      <label className="inline-flex items-center gap-1.5 text-[12px]">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        Move everything back and reopen the duplicate
      </label>
      <div className="flex gap-2">
        <button
          className={btn.secondary}
          disabled={pending || !sure || reason.trim().length < 5}
          onClick={() =>
            start(async () => {
              const r = await mergeUndoAction(id, reason);
              if (!r.ok) return void toast.error(r.error);
              toast.success('Merge undone');
            })
          }
        >
          Undo merge
        </button>
        <button className={btn.ghost} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
