'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Plus, ShieldAlert, Shapes, Trash2, X } from 'lucide-react';
import type { MemberTypeRule } from '@madp/contracts';
import { saveTypeColumnsAction } from '@/app/member-views-actions';
import { TopicInfo } from '@/components/screen-info';
import type { PanelCategory } from './shared';

type Draft = { category: string; label: string; questions: string; sensitive: boolean; aliases?: Record<string, string> };
const toDraft = (r: MemberTypeRule): Draft => ({ ...r, questions: r.questions.join(', ') });
const field = 'rounded-lg border border-border bg-surface px-2 py-1 text-[12px]';

/**
 * Which question-bank answers fill the Type column, per segment of this brand: B2B designation, HCP type, caregiver
 * type, patient condition and so on. Segment managers change it; everyone with Members access sees the result.
 */
export function TypeColumns({
  rules,
  saved,
  categories,
  sensitivePanel,
  hidden,
  canEdit,
}: {
  rules: MemberTypeRule[];
  saved: boolean;
  categories: PanelCategory[];
  sensitivePanel: boolean;
  hidden: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Draft[]>(rules.map(toDraft));
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const known = new Set(categories.map((c) => c.value));

  const save = () =>
    start(async () => {
      const out: MemberTypeRule[] = rows.map((r) => ({
        category: r.category.trim().toLowerCase(),
        label: r.label.trim(),
        questions: r.questions.split(',').map((q) => q.trim().toLowerCase()).filter(Boolean),
        sensitive: r.sensitive,
        ...(r.aliases ? { aliases: r.aliases } : {}),
      }));
      const res = await saveTypeColumnsAction(out);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Type column saved for this brand');
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[#14b8a6] to-[#0ea5e9] text-white shadow-sm">
            <Shapes className="size-3.5" aria-hidden />
          </span>
          Type column
        </span>
        <TopicInfo
          title="Type column"
          help={{
            why: 'See at a glance what kind of member someone is: a consumer’s work, a B2B designation, the HCP type, home or professional caregiver, a patient’s condition.',
            where: 'The answers members gave in the panel’s question bank, read live from the panel for the page you see. Nothing is copied into MADP.',
            how: [
              'Each line says: for members of this segment, show the answers to these questions under this name.',
              'Use question keys from Question bank (for example jobrole or caregiving-situation). Up to 8 questions in all.',
              sensitivePanel
                ? 'This panel holds health data, so every Type answer shows only to admins with health access, and each look is in the audit log.'
                : 'Tick "Health data" for any question about health: those answers then show only to admins with health access.',
            ],
          }}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {rules.length === 0 ? <span className="text-[12px] text-fg-3">No Type columns on this brand yet.</span> : null}
          {rules.map((r) => (
            <span
              key={`${r.category}-${r.label}`}
              className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,#14b8a6_30%,transparent)] bg-[color-mix(in_oklab,#14b8a6_10%,transparent)] px-2.5 py-0.5 text-[12px] font-medium text-[#0f766e] dark:text-[#5eead4]"
              title={`Questions: ${r.questions.join(', ')}`}
            >
              {r.sensitive || sensitivePanel ? <ShieldAlert className="size-3" aria-label="Health data" /> : null}
              <span>
                <span className="capitalize">{r.category}</span>: {r.label}
              </span>
            </span>
          ))}
          {!saved && rules.length ? <span className="text-[11px] text-fg-3">(starting set)</span> : null}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#14b8a6] to-[#0ea5e9] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:-translate-y-px"
          >
            Change
          </button>
        ) : null}
      </div>
      {hidden ? (
        <p className="mt-2 text-[12px] text-fg-3">
          {hidden === 1 ? 'One Type answer is' : `${hidden} Type answers are`} hidden: they are health data and your role has no health access on this brand.
        </p>
      ) : null}
      {open ? (
        <div className="rise mt-3 grid gap-2 border-t border-border pt-3 text-[12px]">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 rounded-xl bg-surface-2/50 p-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,9rem)_minmax(0,1fr)_auto_auto] sm:items-center">
              <label className="grid gap-0.5">
                <span className="text-fg-3">Segment</span>
                <select value={r.category} onChange={(e) => set(i, { category: e.target.value })} className={field}>
                  {!known.has(r.category) ? <option value={r.category}>{r.category || 'Pick one'}</option> : null}
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.value} ({c.segments.join(', ')})
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-0.5">
                <span className="text-fg-3">Shown as</span>
                <input value={r.label} onChange={(e) => set(i, { label: e.target.value })} maxLength={40} placeholder="Designation" className={field} />
              </label>
              <label className="grid gap-0.5">
                <span className="text-fg-3">Question keys (comma between)</span>
                <input value={r.questions} onChange={(e) => set(i, { questions: e.target.value })} placeholder="jobrole" className={`${field} font-mono`} />
              </label>
              <label className="inline-flex items-center gap-1.5 sm:pt-4">
                <input type="checkbox" checked={r.sensitive || sensitivePanel} disabled={sensitivePanel} onChange={(e) => set(i, { sensitive: e.target.checked })} /> Health data
              </label>
              <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${r.label || 'line'}`} className="justify-self-start rounded-lg p-1.5 text-fg-3 hover:bg-surface hover:text-danger sm:mt-4">
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRows((x) => [...x, { category: categories[0]?.value ?? '', label: '', questions: '', sensitive: false }])}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 font-medium text-fg-2 hover:bg-surface-2"
            >
              <Plus className="size-3.5" aria-hidden /> Add a line
            </button>
            <button type="button" disabled={pending} onClick={save} className="inline-flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              <Check className="size-3.5" aria-hidden /> Save
            </button>
            <button type="button" onClick={() => { setRows(rules.map(toDraft)); setOpen(false); }} className="rounded-xl px-2 py-1.5 text-fg-3 hover:bg-surface-2" aria-label="Cancel">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
