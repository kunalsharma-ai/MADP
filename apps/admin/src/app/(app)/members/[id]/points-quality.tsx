'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { pointsAdjustAction, qualityChangeAction } from '@/app/panel-actions';
import { Card, CardHeader, btn, fmt, input } from '@/components/ui';

const REASONS = [
  'goodwill',
  'survey_credit_missing',
  'survey_reversal',
  'fraud_reversal',
  'duplicate_payment',
  'support_fix',
  'migration',
  'other',
];
const RULES = [
  'speeding',
  'straightlining',
  'open_end_quality',
  'attention_check',
  'client_rejection',
  'duplicate_account',
  'manual_review',
  'restore',
];
const label = (s: string) => s.replaceAll('_', ' ');

/** Points adjustment (points.adjust) and quality score change (quality.manage). The API refuses what the role lacks. */
export function PointsQuality({ member, score }: { member: string; score: number | null }) {
  const [pending, start] = useTransition();
  const [points, setPoints] = useState('');
  const [code, setCode] = useState('goodwill');
  const [note, setNote] = useState('');
  const [rule, setRule] = useState('manual_review');
  const [delta, setDelta] = useState('');
  const [qnote, setQnote] = useState('');
  const adjust = () =>
    start(async () => {
      const r = await pointsAdjustAction(member, Number(points), code, note);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        r.data.adjustment.status === 'pending'
          ? `Waiting for a second admin (four eyes from ${fmt(r.data.fourEyesAt)} points)`
          : `Applied: ${fmt(r.data.before.available)} → ${fmt(r.data.after.available)} available`,
      );
      setPoints('');
      setNote('');
    });
  const change = () =>
    start(async () => {
      const r = await qualityChangeAction(member, rule, Number(delta), qnote);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Quality ${r.data.before.score} → ${r.data.after.score}`);
      setDelta('');
      setQnote('');
    });
  return (
    <Card>
      <CardHeader
        title="Points and quality"
        hint="Both need a note and are audited with the old and new values."
      />
      <div className="grid gap-4 px-5 py-4 text-[13px]">
        <div className="grid gap-2">
          <p className="font-medium">Adjust points</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={input}
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="+500 or -200"
            />
            <select className={input} value={code} onChange={(e) => setCode(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
          </div>
          <input
            className={input}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
          />
          <button
            className={btn.secondary}
            disabled={pending || !Number(points) || note.trim().length < 5}
            onClick={adjust}
          >
            Adjust
          </button>
        </div>
        <div className="grid gap-2 border-t border-border pt-4">
          <p className="font-medium">Quality score {score ?? 100}</p>
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={rule} onChange={(e) => setRule(e.target.value)}>
              {RULES.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
            <input
              className={input}
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="-20 or +10"
            />
          </div>
          <input
            className={input}
            value={qnote}
            onChange={(e) => setQnote(e.target.value)}
            placeholder="Note"
          />
          <button
            className={btn.secondary}
            disabled={pending || !Number(delta) || qnote.trim().length < 5}
            onClick={change}
          >
            Change score
          </button>
        </div>
      </div>
    </Card>
  );
}
