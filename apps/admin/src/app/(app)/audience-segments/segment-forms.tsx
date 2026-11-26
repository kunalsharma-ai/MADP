'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { AudienceSegmentInfo, SegmentRuleInfo } from '@madp/contracts';
import { usePanels } from '@/components/panels-context';
import { btn, input } from '@/components/ui';
import {
  addRuleAction,
  createSegmentAction,
  ruleStateAction,
  segmentStateAction,
  updateSegmentAction,
} from './actions';
import { unwrap } from '@/lib/result';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const ask = (what: string) => window.prompt(`Reason to ${what} (kept in the audit log)`)?.trim();

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>, ok: string, after?: () => void) =>
    start(async () => {
      try {
        await fn();
        toast.success(ok);
        after?.();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, run };
}

/** Add a MADP segment. It gets members only once a rule links a panel's category value to it. */
export function CreateSegment() {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  if (!open)
    return (
      <button className={btn.primary} onClick={() => setOpen(true)}>
        Add a segment
      </button>
    );
  return (
    <form
      className="grid gap-3 rounded-xl border border-border bg-surface p-5 text-[13px] md:grid-cols-2"
      action={(f) =>
        run(
          () =>
            unwrap(createSegmentAction({
              key: str(f, 'key').toLowerCase(),
              label: str(f, 'label'),
              ...(str(f, 'description') ? { description: str(f, 'description') } : {}),
              minors: f.get('minors') === 'on',
              reason: str(f, 'reason'),
            })),
          'Segment added. Add a rule below so members join it.',
          () => setOpen(false),
        )
      }
    >
      <label className="grid gap-1">
        <span className="text-fg-2">Name</span>
        <input name="label" required minLength={2} maxLength={60} placeholder="Students" className={input} />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-2">Key</span>
        <input name="key" required pattern="[a-z][a-z0-9_]{1,31}" placeholder="students" className={input} />
        <span className="text-[11px] text-fg-3">Lowercase letters, digits or _. It can&apos;t be changed later.</span>
      </label>
      <label className="grid gap-1 md:col-span-2">
        <span className="text-fg-2">Description (optional)</span>
        <textarea name="description" rows={2} maxLength={1000} className={input} />
      </label>
      <label className="flex items-start gap-2 md:col-span-2">
        <input type="checkbox" name="minors" className="mt-0.5" />
        <span>
          Every member is under 18. MADP&apos;s minor protections then always apply to its members, as for
          Teens, and every rule into it marks members as minors.
        </span>
      </label>
      <label className="grid gap-1 md:col-span-2">
        <span className="text-fg-2">Reason (kept in the audit log)</span>
        <input name="reason" required minLength={5} maxLength={500} className={input} />
      </label>
      <div className="flex gap-2 md:col-span-2">
        <button className={btn.primary} disabled={pending}>
          Add segment
        </button>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Edit, archive, restore or delete one segment. */
export function SegmentActions({ segment: s, hasMembers }: { segment: AudienceSegmentInfo; hasMembers: boolean }) {
  const [editing, setEditing] = useState(false);
  const { pending, run } = useRun();
  const lockMinors = s.key === 'teen' || hasMembers;
  const state = (action: 'archive' | 'restore' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Delete ${s.label}? This can't be undone.`)) return;
    const reason = ask(`${action} ${s.label}`);
    if (!reason) return;
    run(
      () => unwrap(segmentStateAction(s.key, action, reason)),
      action === 'delete' ? 'Segment deleted' : action === 'archive' ? 'Segment archived' : 'Segment restored',
    );
  };
  if (editing)
    return (
      <form
        className="grid gap-2 py-2 text-[13px]"
        action={(f) => {
          const patch: Record<string, unknown> = {};
          if (str(f, 'label') !== s.label) patch.label = str(f, 'label');
          if (str(f, 'description') !== s.description) patch.description = str(f, 'description');
          if (Number(str(f, 'sort')) !== s.sort) patch.sort = Number(str(f, 'sort'));
          const minors = lockMinors ? s.minors : f.get('minors') === 'on';
          if (minors !== s.minors) patch.minors = minors;
          if (!Object.keys(patch).length) {
            toast.error('Nothing changed');
            return;
          }
          run(() => unwrap(updateSegmentAction(s.key, { ...patch, reason: str(f, 'reason') })), 'Saved', () => setEditing(false));
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
          <input name="label" defaultValue={s.label} required minLength={2} maxLength={60} className={input} aria-label="Name" />
          <input name="sort" type="number" min={1} max={999} defaultValue={s.sort} className={input} aria-label="Order" />
        </div>
        <textarea name="description" rows={2} maxLength={1000} defaultValue={s.description} className={input} aria-label="Description" />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="minors" defaultChecked={s.minors} disabled={lockMinors} />
          <span>
            Every member is under 18
            {lockMinors ? (
              <span className="text-fg-3"> (stays as it is: {s.key === 'teen' ? 'Teens' : 'the segment has members'})</span>
            ) : null}
          </span>
        </label>
        <input name="reason" required minLength={5} maxLength={500} placeholder="Reason (kept in the audit log)" className={input} />
        <div className="flex gap-2">
          <button className={btn.primary} disabled={pending}>
            Save
          </button>
          <button type="button" className={btn.secondary} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <button className={btn.ghost} disabled={pending} onClick={() => setEditing(true)}>
        Edit
      </button>
      {s.status === 'active' ? (
        <button className={btn.ghost} disabled={pending} onClick={() => state('archive')}>
          Archive
        </button>
      ) : (
        <button className={btn.ghost} disabled={pending} onClick={() => state('restore')}>
          Restore
        </button>
      )}
      {s.builtIn || hasMembers ? null : (
        <button className={btn.ghost + ' text-danger'} disabled={pending} onClick={() => state('delete')}>
          Delete
        </button>
      )}
    </div>
  );
}

/** Link a panel's own category value (as it stores it, e.g. "b2c") to a segment. */
export function AddRule({ segments }: { segments: AudienceSegmentInfo[] }) {
  const panels = usePanels();
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  if (!open)
    return (
      <button className={btn.secondary} onClick={() => setOpen(true)}>
        Add a rule
      </button>
    );
  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-4 text-[13px] md:grid-cols-4"
      action={(f) =>
        run(
          () =>
            unwrap(addRuleAction({
              panel: str(f, 'panel'),
              sourceValue: str(f, 'sourceValue'),
              segment: str(f, 'segment'),
              minor: f.get('minor') === 'on',
              ...(str(f, 'evidence') ? { evidence: str(f, 'evidence') } : {}),
              reason: str(f, 'reason'),
            })),
          'Rule added. New syncs use it.',
          () => setOpen(false),
        )
      }
    >
      <label className="grid gap-1">
        <span className="text-fg-2">Panel</span>
        <select name="panel" required className={input}>
          {panels.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-fg-2">Panel category value</span>
        <input name="sourceValue" required maxLength={80} placeholder="b2c" className={input} />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-2">Joins segment</span>
        <select name="segment" required className={input}>
          {segments.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-end gap-2 pb-2">
        <input type="checkbox" name="minor" />
        <span>Members are minors</span>
      </label>
      <label className="grid gap-1 md:col-span-2">
        <span className="text-fg-2">Where this value comes from (optional)</span>
        <input name="evidence" maxLength={500} placeholder="Sign-up form, category field" className={input} />
      </label>
      <label className="grid gap-1 md:col-span-2">
        <span className="text-fg-2">Reason (kept in the audit log)</span>
        <input name="reason" required minLength={5} maxLength={500} className={input} />
      </label>
      <div className="flex gap-2 md:col-span-4">
        <button className={btn.primary} disabled={pending}>
          Add rule
        </button>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RuleActions({ rule: r }: { rule: SegmentRuleInfo }) {
  const { pending, run } = useRun();
  const state = (action: 'archive' | 'restore' | 'delete') => {
    if (action === 'delete' && !window.confirm('Delete this rule?')) return;
    const reason = ask(`${action} this rule`);
    if (!reason) return;
    run(() => unwrap(ruleStateAction(r.id, action, reason)), action === 'delete' ? 'Rule deleted' : 'Saved');
  };
  return (
    <div className="flex justify-end gap-1">
      {r.status === 'active' ? (
        <button className={btn.ghost} disabled={pending} onClick={() => state('archive')}>
          Archive
        </button>
      ) : (
        <button className={btn.ghost} disabled={pending} onClick={() => state('restore')}>
          Restore
        </button>
      )}
      <button className={btn.ghost + ' text-danger'} disabled={pending} onClick={() => state('delete')}>
        Delete
      </button>
    </div>
  );
}
