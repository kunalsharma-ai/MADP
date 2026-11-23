'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { Attribute, MappingRow } from '@/lib/types';
import { decideMapping } from '../../actions';
import { Badge, PanelChip, btn } from '@/components/ui';

export function MappingRowView({ m, attributes }: { m: MappingRow; attributes: Attribute[] }) {
  const [attr, setAttr] = useState(m.attributeKey ?? m.suggestedAttributeKey ?? '');
  const [pending, start] = useTransition();
  const act = (decision: 'approve' | 'reject' | 'needs_info') =>
    start(async () => {
      try {
        await decideMapping(m.id, decision, decision === 'approve' ? attr : undefined);
        toast.success(`${m.sourceQuestionId}: ${decision.replace('_', ' ')}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  const editable = m.status === 'pending' || m.status === 'needs_info';
  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PanelChip panel={m.panel} />
          <span className="font-mono text-xs">{m.sourceQuestionId}</span>
          <span className="text-[11px] text-fg-3">v{m.questionVersion}</span>
          {m.sensitivity === 'special_category' ? (
            <Badge tone="danger">{m.panel === 'mho' ? 'health / special' : 'special category'}</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-[13px]">{m.label ?? '—'}</p>
        {m.sampleOptions.length ? (
          <p className="mt-0.5 truncate text-[11px] text-fg-3">
            Options: {m.sampleOptions.map((o) => o.label).join(' · ')}
          </p>
        ) : null}
      </div>
      <div>
        <label className="sr-only" htmlFor={`attr-${m.id}`}>
          Canonical attribute
        </label>
        <select
          id={`attr-${m.id}`}
          value={attr}
          onChange={(e) => setAttr(e.target.value)}
          disabled={!editable || pending}
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px]"
        >
          <option value="">Choose canonical attribute…</option>
          {attributes.map((a) => (
            <option key={a.key} value={a.key}>
              {a.key} — {a.label}
            </option>
          ))}
        </select>
        {m.suggestedAttributeKey && editable ? (
          <p className="mt-1 text-[11px] text-fg-3">
            Suggested: {m.suggestedAttributeKey} ({m.suggestionBasis})
          </p>
        ) : null}
      </div>
      <div className="flex gap-1.5">
        {editable ? (
          <>
            <button className={btn.primary} disabled={!attr || pending} onClick={() => act('approve')}>
              Approve
            </button>
            <button className={btn.secondary} disabled={pending} onClick={() => act('needs_info')}>
              Needs info
            </button>
            <button className={btn.ghost} disabled={pending} onClick={() => act('reject')}>
              Not mappable
            </button>
          </>
        ) : (
          <Badge tone={m.status === 'approved' ? 'teal' : 'neutral'}>
            {m.status}
            {m.attributeKey ? ` → ${m.attributeKey}` : ''}
          </Badge>
        )}
      </div>
    </li>
  );
}
