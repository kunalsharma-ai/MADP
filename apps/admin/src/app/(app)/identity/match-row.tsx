'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { PanelCode } from '@madp/contracts';
import { decideIdentityMatch, unlinkIdentity } from '../../actions';
import { Badge, PanelChip, btn } from '@/components/ui';

interface Side {
  id: string;
  panel: PanelCode;
  sourceCategory: string;
  emailMasked: string | null;
  emailVerification: string;
}
export interface Match {
  id: string;
  rule: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  linked: boolean;
  identity: Side & { personId: string };
  candidate: { personId: string; identities: Side[] };
}

const Account = ({ s }: { s: Side }) => (
  <div className="flex flex-wrap items-center gap-2 text-[13px]">
    <PanelChip panel={s.panel} />
    <span className="font-mono text-xs">{s.emailMasked ?? 'no e-mail'}</span>
    <span className="text-fg-3">{s.sourceCategory}</span>
    <Badge tone={s.emailVerification === 'verified' ? 'teal' : 'neutral'}>{s.emailVerification}</Badge>
  </div>
);

export function MatchRow({ m }: { m: Match }) {
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      try {
        await fn();
        toast.success(ok);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-fg-3">New account</p>
        <Account s={m.identity} />
        <Link className="mt-1 inline-block text-[11px] text-fg-3 underline" href={`/panellists/${m.identity.personId}`}>
          Its person
        </Link>
      </div>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-fg-3">Looks like this person</p>
        <div className="space-y-1">
          {m.candidate.identities.length ? (
            m.candidate.identities.map((s) => <Account key={s.id} s={s} />)
          ) : (
            <p className="text-[12px] text-fg-3">No other accounts left on this person.</p>
          )}
        </div>
        <p className="mt-1 text-[11px] text-fg-3">Rule: {m.rule.replaceAll('_', ' ')}</p>
      </div>
      <div className="flex min-w-56 flex-col gap-1.5">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={m.status === 'pending' ? 'Reason (optional)' : 'Reason (required to unmerge)'}
          aria-label="Reason"
          className="rounded-md border border-border bg-surface px-2 py-1 text-[12px]"
          disabled={pending}
        />
        {m.status === 'pending' ? (
          <div className="flex gap-1.5">
            <button
              className={btn.primary}
              disabled={pending}
              onClick={() => run(() => decideIdentityMatch(m.id, 'approve', reason || undefined), 'Merged')}
            >
              Merge
            </button>
            <button
              className={btn.ghost}
              disabled={pending}
              onClick={() => run(() => decideIdentityMatch(m.id, 'reject', reason || undefined), 'Kept apart')}
            >
              Different people
            </button>
          </div>
        ) : m.status === 'approved' && m.linked ? (
          <button
            className={btn.secondary}
            disabled={pending || reason.trim().length < 3}
            onClick={() => run(() => unlinkIdentity(m.identity.id, reason.trim(), m.identity.personId), 'Unmerged')}
          >
            Unmerge
          </button>
        ) : (
          <Badge tone="neutral">{m.status}</Badge>
        )}
      </div>
    </li>
  );
}
