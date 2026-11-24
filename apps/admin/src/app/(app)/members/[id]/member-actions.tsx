'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  memberEditAction,
  memberSegmentAction,
  memberStatusAction,
  memberUnmaskAction,
} from '@/app/panel-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

const MOVES: Record<string, string[]> = {
  active: ['suspend', 'ban', 'archive'],
  suspended: ['reactivate', 'ban'],
  banned: ['reactivate'],
  archived: ['restore', 'ban'],
};
const FIELDS = [
  ['email', 'E-mail'],
  ['phone', 'Phone'],
  ['dob', 'Date of birth'],
  ['address', 'Address'],
  ['payment', 'Payment details'],
  ['guardianEmail', 'Guardian e-mail'],
] as const;

export function MemberActions({
  member,
  canUnmask,
}: {
  member: {
    id: string;
    status: string;
    segment: string;
    category: string;
    emailVerified: string;
    phoneVerified: string;
  };
  canUnmask: boolean;
}) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState<Record<string, unknown> | null>(null);
  const [fields, setFields] = useState<string[]>(['email']);
  const ok = reason.trim().length >= 5;
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
    });
  return (
    <Card>
      <CardHeader
        title="Actions"
        hint="Every action needs a reason and goes into the audit log with the old and new values."
      />
      <div className="grid gap-4 px-5 py-4 text-[13px]">
        <label>
          Reason
          <input
            className={input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why, in a sentence"
          />
        </label>
        <div>
          <p className="mb-1.5 text-fg-3">Status</p>
          <div className="flex flex-wrap gap-2">
            {(MOVES[member.status] ?? []).map((a) => (
              <button
                key={a}
                className={btn.secondary}
                disabled={pending || !ok}
                onClick={() => act(() => memberStatusAction(member.id, a, reason), `Member ${a}d`)}
              >
                {a[0]!.toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-fg-3">Verification</p>
          <div className="flex flex-wrap gap-2">
            {member.emailVerified !== 'verified' ? (
              <button
                className={btn.secondary}
                disabled={pending || !ok}
                onClick={() =>
                  act(
                    () => memberEditAction(member.id, { 'isVerified.email': 'verified' }, reason),
                    'E-mail marked verified',
                  )
                }
              >
                Verify e-mail
              </button>
            ) : null}
            {member.phoneVerified !== 'verified' ? (
              <button
                className={btn.secondary}
                disabled={pending || !ok}
                onClick={() =>
                  act(
                    () => memberEditAction(member.id, { 'isVerified.phone': 'verified' }, reason),
                    'Phone marked verified',
                  )
                }
              >
                Verify phone
              </button>
            ) : null}
            <button
              className={btn.secondary}
              disabled={pending || !ok}
              onClick={() =>
                act(
                  () => memberEditAction(member.id, { 'isVerified.email': 'rejected' }, reason),
                  'E-mail rejected',
                )
              }
            >
              Reject e-mail
            </button>
          </div>
        </div>
        {member.segment !== 'teen' ? (
          <div>
            <p className="mb-1.5 text-fg-3">Segment (answers are kept)</p>
            <div className="flex flex-wrap gap-2">
              {['b2c', 'b2b']
                .filter((c) => c !== member.category)
                .map((c) => (
                  <button
                    key={c}
                    className={btn.secondary}
                    disabled={pending || !ok}
                    onClick={() => act(() => memberSegmentAction(member.id, c, reason), `Moved to ${c}`)}
                  >
                    Move to {c === 'b2b' ? 'Business Professional' : 'Consumer'}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <p className="text-fg-3">
            Teen accounts move to an adult account through the turning-18 path in the Teen module.
          </p>
        )}
        {canUnmask ? (
          <div>
            <p className="mb-1.5 text-fg-3">Show full values</p>
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
              {FIELDS.map(([k, label]) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={fields.includes(k)}
                    onChange={(e) =>
                      setFields((f) => (e.target.checked ? [...f, k] : f.filter((x) => x !== k)))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <button
              className={btn.secondary}
              disabled={pending || !ok || fields.length === 0}
              onClick={() =>
                start(async () => {
                  const r = await memberUnmaskAction(member.id, fields, reason);
                  if (!r.ok) return void toast.error(r.error);
                  setShown(r.data.values);
                })
              }
            >
              Unmask
            </button>
            {shown ? (
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px]">
                {JSON.stringify(shown, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : (
          <p className="text-fg-3">Your role can&apos;t unmask personal data on this brand.</p>
        )}
      </div>
    </Card>
  );
}
