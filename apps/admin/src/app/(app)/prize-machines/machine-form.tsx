'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { PrizeMachineView } from '@madp/contracts';
import { prizeMachineSaveAction } from '@/app/step4-actions';
import { btn, input } from '@/components/ui';

type Prize = { label: string; kind: 'points' | 'badge' | 'nothing'; points: string; weight: string };

/** Edit one segment's machine: title, status, daily plays, countries, prizes and odds. Saving needs a reason. */
export function MachineForm({ m }: { m: PrizeMachineView }) {
  const teen = m.segment === 'teen';
  const [title, setTitle] = useState(m.title ?? '');
  const [status, setStatus] = useState(m.status);
  const [plays, setPlays] = useState(String(m.dailyPlays));
  const [countries, setCountries] = useState(m.countries.join(', '));
  const [prizes, setPrizes] = useState<Prize[]>(
    m.prizes.length
      ? m.prizes.map((p) => ({
          label: p.label,
          kind: p.kind,
          points: String(p.points || ''),
          weight: String(p.weight),
        }))
      : [
          {
            label: teen ? 'Explorer badge' : '25 points',
            kind: teen ? 'badge' : 'points',
            points: teen ? '' : '25',
            weight: '1',
          },
        ],
  );
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const total = prizes.reduce((s, p) => s + (Number(p.weight) > 0 ? Number(p.weight) : 0), 0);
  const avg = total
    ? prizes.reduce(
        (s, p) => s + (p.kind === 'points' ? Number(p.points || 0) * Number(p.weight || 0) : 0),
        0,
      ) / total
    : 0;
  const setP = (i: number, k: keyof Prize, v: string) =>
    setPrizes(prizes.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const kinds = teen ? (['badge', 'nothing'] as const) : (['points', 'badge', 'nothing'] as const);
  return (
    <div className="grid gap-3 px-5 py-4 text-[13px]">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="md:col-span-2">
          Title
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </label>
        <label>
          Status
          <select
            className={input}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="draft">Draft</option>
            <option value="live">Live</option>
            <option value="paused">Paused</option>
          </select>
        </label>
        <label>
          Plays per member per day
          <input
            className={input}
            value={plays}
            onChange={(e) => setPlays(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="md:col-span-4">
          Countries legal has cleared (comma separated)
          <input
            className={input}
            value={countries}
            onChange={(e) => setCountries(e.target.value)}
            placeholder="india, us"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[12.5px]">
          <thead className="text-[11px] uppercase tracking-wide text-fg-3">
            <tr>
              <th className="py-1 pr-2 font-medium">Prize</th>
              <th className="py-1 pr-2 font-medium">Kind</th>
              <th className="py-1 pr-2 font-medium">Points</th>
              <th className="py-1 pr-2 font-medium">Weight</th>
              <th className="py-1 pr-2 font-medium">Chance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {prizes.map((p, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <input
                    className={`${input} py-1`}
                    value={p.label}
                    onChange={(e) => setP(i, 'label', e.target.value)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <select
                    className={`${input} py-1`}
                    value={p.kind}
                    onChange={(e) => setP(i, 'kind', e.target.value)}
                  >
                    {kinds.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </td>
                <td className="w-24 py-1 pr-2">
                  <input
                    className={`${input} py-1`}
                    value={p.kind === 'points' ? p.points : ''}
                    disabled={p.kind !== 'points'}
                    onChange={(e) => setP(i, 'points', e.target.value)}
                    inputMode="numeric"
                  />
                </td>
                <td className="w-24 py-1 pr-2">
                  <input
                    className={`${input} py-1`}
                    value={p.weight}
                    onChange={(e) => setP(i, 'weight', e.target.value)}
                    inputMode="decimal"
                  />
                </td>
                <td className="w-16 py-1 pr-2 tabular-nums text-fg-2">
                  {total ? `${Math.round((Math.max(0, Number(p.weight) || 0) / total) * 1000) / 10}%` : '—'}
                </td>
                <td className="py-1">
                  <button
                    className={btn.ghost}
                    onClick={() => setPrizes(prizes.filter((_, j) => j !== i))}
                    disabled={prizes.length === 1}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={btn.ghost}
          disabled={prizes.length >= 12}
          onClick={() =>
            setPrizes([...prizes, { label: '', kind: teen ? 'badge' : 'points', points: '', weight: '1' }])
          }
        >
          Add a prize
        </button>
        <span className="text-[12px] text-fg-3">
          {teen
            ? 'Teen prizes are badges or “try again”: never points or money.'
            : `About ${Math.round(avg * 10) / 10} points paid per play at these odds.`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${input} max-w-md`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (kept in the audit log)"
          maxLength={500}
        />
        <button
          className={btn.primary}
          disabled={pending || reason.trim().length < 5 || title.trim().length < 2}
          onClick={() =>
            start(async () => {
              const r = await prizeMachineSaveAction(m.segment, {
                title: title.trim(),
                status,
                dailyPlays: Number(plays),
                countries: countries
                  .split(',')
                  .map((c) => c.trim().toLowerCase())
                  .filter(Boolean),
                prizes: prizes.map((p) => ({
                  label: p.label.trim(),
                  kind: p.kind,
                  ...(p.kind === 'points' ? { points: Number(p.points) } : {}),
                  weight: Number(p.weight),
                })),
                reason: reason.trim(),
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success('Machine saved');
              setReason('');
            })
          }
        >
          Save machine
        </button>
      </div>
    </div>
  );
}
