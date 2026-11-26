'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { Attribute, MappingRow } from '@/lib/types';
import { decideMapping, questionOptions } from '../../actions';
import { Check, HelpCircle, Sparkles, X } from 'lucide-react';
import { unwrap } from '@/lib/result';
import { Badge, PanelChip, btn } from '@/components/ui';

export function MappingRowView({ m, attributes }: { m: MappingRow; attributes: Attribute[] }) {
  const [attr, setAttr] = useState(m.attributeKey ?? m.suggestedAttributeKey ?? '');
  const [pending, start] = useTransition();
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null);
  const [valueMap, setValueMap] = useState<Record<string, string>>(m.valueMap ?? {});
  const openValueMap = () =>
    start(async () => {
      try {
        const opts = await unwrap(questionOptions(m.panel, m.sourceQuestionId, m.questionVersion));
        setOptions(opts);
        // Start from a lower-case, trimmed copy of each source value; the steward edits from there.
        setValueMap((cur) =>
          Object.keys(cur).length
            ? cur
            : Object.fromEntries(opts.map((o) => [o.value, o.value.split(',')[0]!.trim().toLowerCase()])),
        );
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  const act = (decision: 'approve' | 'reject' | 'needs_info') =>
    start(async () => {
      try {
        const map = Object.fromEntries(Object.entries(valueMap).filter(([, v]) => v.trim() !== ''));
        await unwrap(decideMapping(
          m.id,
          decision,
          decision === 'approve' ? attr : undefined,
          undefined,
          decision === 'approve' && options ? map : undefined,
        ));
        toast.success(decision === 'approve' ? 'Approved and linked' : decision === 'reject' ? 'Marked as not mappable' : 'Marked as needing info');
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  const editable = m.status === 'pending' || m.status === 'needs_info';
  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1fr_auto] lg:items-center">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-fg">{m.label ?? m.sourceQuestionId}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <PanelChip panel={m.panel} />
          <span className="font-mono text-[11px] text-fg-3">
            {m.sourceQuestionId} · v{m.questionVersion}
          </span>
          {m.sensitivity === 'special_category' ? (
            <Badge tone="danger">{m.panel === 'mho' ? 'health, sensitive' : 'sensitive'}</Badge>
          ) : null}
        </div>
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
          className="w-full rounded-xl border border-border bg-surface px-2.5 py-2 text-[13px]"
        >
          <option value="">Pick the shared question…</option>
          {attributes.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label} ({a.key})
            </option>
          ))}
        </select>
        {m.suggestedAttributeKey && editable ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[#7c3aed]">
            <Sparkles className="size-3" aria-hidden /> We suggest {attributes.find((a) => a.key === m.suggestedAttributeKey)?.label ?? m.suggestedAttributeKey}
          </p>
        ) : null}
      </div>
      <div className="flex gap-1.5">
        {editable ? (
          <>
            <button className={btn.primary} disabled={!attr || pending} onClick={() => act('approve')}>
              <Check className="size-4" aria-hidden /> Approve
            </button>
            <button className={btn.secondary} disabled={pending} onClick={() => act('needs_info')} title="Park it until someone can check">
              <HelpCircle className="size-4" aria-hidden /> Needs info
            </button>
            <button className={btn.ghost} disabled={pending} onClick={() => act('reject')} title="This question has no shared equivalent">
              <X className="size-4" aria-hidden /> Can&apos;t map
            </button>
          </>
        ) : (
          <Badge tone={m.status === 'approved' ? 'teal' : 'neutral'}>
            {m.status}
            {m.attributeKey ? ` → ${m.attributeKey}` : ''}
          </Badge>
        )}
      </div>
      {editable && m.sampleOptions.length ? (
        <div className="lg:col-span-3">
          {options === null ? (
            <button className={btn.ghost} disabled={pending} onClick={openValueMap}>
              Match the answer options too (optional)…
            </button>
          ) : options.length === 0 ? (
            <p className="text-[12px] text-fg-3">This question version has no stored options to map.</p>
          ) : (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-[12px] font-medium">
                Value map: source option → canonical value (leave blank to exclude it from counts)
              </legend>
              <div className="grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {options.map((o) => (
                  <label key={o.value} className="flex min-w-0 items-center gap-2 text-[12px]">
                    <span className="w-1/2 truncate text-fg-2" title={o.value}>
                      {o.label}
                    </span>
                    <input
                      value={valueMap[o.value] ?? ''}
                      onChange={(e) => setValueMap((cur) => ({ ...cur, [o.value]: e.target.value }))}
                      disabled={pending}
                      maxLength={200}
                      aria-label={`Canonical value for ${o.label}`}
                      className="w-1/2 min-w-0 rounded-md border border-border bg-surface px-2 py-1 font-mono"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      ) : null}
      {!editable && m.valueMap && Object.keys(m.valueMap).length ? (
        <p className="text-[11px] text-fg-3 lg:col-span-3">
          Value map:{' '}
          {Object.entries(m.valueMap)
            .slice(0, 8)
            .map(([k, v]) => `${k} → ${v}`)
            .join(' · ')}
          {Object.keys(m.valueMap).length > 8 ? ' …' : ''}
        </p>
      ) : null}
    </li>
  );
}
