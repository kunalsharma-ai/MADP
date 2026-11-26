'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { PanelInfo } from '@madp/contracts';
import { btn, input } from '@/components/ui';
import { createPanelAction, panelStateAction, updatePanelAction } from './actions';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Add a panel that runs on the shared panel backend. It starts on DEMO until its connection is set. */
export function CreatePanel() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open)
    return (
      <button className={btn.primary} onClick={() => setOpen(true)}>
        Add a panel
      </button>
    );
  return (
    <form
      className="grid w-full gap-3 rounded-xl border border-border bg-surface p-5 text-[13px] md:grid-cols-2"
      action={(f) =>
        start(async () => {
          try {
            const origins = str(f, 'origins')
              .split(/[\s,]+/)
              .map((o) => o.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
              .filter(Boolean);
            const r = await createPanelAction({
              code: str(f, 'code').toLowerCase(),
              name: str(f, 'name'),
              shortName: str(f, 'shortName'),
              ...(str(f, 'siteUrl') ? { siteUrl: str(f, 'siteUrl') } : {}),
              ...(str(f, 'description') ? { description: str(f, 'description') } : {}),
              sensitive: f.get('sensitive') === 'on',
              origins,
              reason: str(f, 'reason'),
            });
            toast.success(`Panel ${r.code} added. Set its connection next.`);
            setOpen(false);
            router.push('/panel-connections');
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      <label className="grid gap-1">
        <span className="text-fg-2">Code</span>
        <input name="code" required pattern="[a-z][a-z0-9_]{1,15}" placeholder="kidz" className={input} />
        <span className="text-[11px] text-fg-3">
          2 to 16 lowercase letters, digits or _. It can&apos;t be changed later; it is how the panel is stored.
        </span>
      </label>
      <label className="grid gap-1">
        <span className="text-fg-2">Short name</span>
        <input name="shortName" required minLength={2} maxLength={12} placeholder="KDZ" className={input} />
        <span className="text-[11px] text-fg-3">Shown on chips and in the brand switcher.</span>
      </label>
      <label className="grid gap-1">
        <span className="text-fg-2">Name</span>
        <input name="name" required minLength={2} maxLength={80} placeholder="Kidz Opinions" className={input} />
      </label>
      <label className="grid gap-1">
        <span className="text-fg-2">Website (optional)</span>
        <input name="siteUrl" type="url" placeholder="https://www.example.com" className={input} />
      </label>
      <label className="grid gap-1 md:col-span-2">
        <span className="text-fg-2">Site hostnames</span>
        <input name="origins" required placeholder="www.example.com, example.com" className={input} />
        <span className="text-[11px] text-fg-3">
          The hostnames the panel&apos;s members use. MADP uses them to tell which brand a sign-up or click came
          from. A hostname can belong to one panel only.
        </span>
      </label>
      <label className="grid gap-1 md:col-span-2">
        <span className="text-fg-2">Description (optional)</span>
        <textarea name="description" rows={2} maxLength={1000} className={input} />
      </label>
      <label className="flex items-start gap-2 md:col-span-2">
        <input type="checkbox" name="sensitive" className="mt-0.5" />
        <span>
          Holds health or other special-category data. MADP then applies the same extra controls as MHO (masked
          answers, purpose checks, stricter exports). Once the panel holds data this can&apos;t be turned off.
        </span>
      </label>
      <label className="grid gap-1 md:col-span-2">
        <span className="text-fg-2">Reason (kept in the audit log)</span>
        <input name="reason" required minLength={5} maxLength={500} className={input} />
      </label>
      <div className="flex gap-2 md:col-span-2">
        <button className={btn.primary} disabled={pending}>
          Add panel
        </button>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Edit, archive, restore or delete one panel. Built-in panels can only be edited (names, website, order). */
export function PanelActions({ panel: p, hasData }: { panel: PanelInfo; hasData: boolean }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const ask = (what: string) => window.prompt(`Reason to ${what} (kept in the audit log)`)?.trim();
  const run = (action: 'archive' | 'restore' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Delete ${p.name}? This can't be undone.`)) return;
    const reason = ask(`${action} ${p.shortName}`);
    if (!reason) return;
    start(async () => {
      try {
        await panelStateAction(p.code, action, reason);
        toast.success(action === 'delete' ? 'Panel deleted' : action === 'archive' ? 'Panel archived' : 'Panel restored');
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  };

  if (editing)
    return (
      <form
        className="grid gap-3 border-t border-border px-5 py-4 text-[13px]"
        action={(f) =>
          start(async () => {
            const patch: Record<string, unknown> = {};
            if (str(f, 'name') !== p.name) patch.name = str(f, 'name');
            if (str(f, 'shortName') !== p.shortName) patch.shortName = str(f, 'shortName');
            if (str(f, 'siteUrl') !== (p.siteUrl ?? '')) patch.siteUrl = str(f, 'siteUrl') || null;
            if (str(f, 'description') !== p.description) patch.description = str(f, 'description');
            if (Number(str(f, 'sort')) !== p.sort) patch.sort = Number(str(f, 'sort'));
            const sensitive = f.get('sensitive') === 'on';
            if (sensitive !== p.sensitive) patch.sensitive = sensitive;
            if (!Object.keys(patch).length) {
              toast.error('Nothing changed');
              return;
            }
            try {
              await updatePanelAction(p.code, { ...patch, reason: str(f, 'reason') });
              toast.success('Saved');
              setEditing(false);
            } catch (e) {
              toast.error((e as Error).message);
            }
          })
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-fg-2">Name</span>
            <input name="name" defaultValue={p.name} required minLength={2} maxLength={80} className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-fg-2">Short name</span>
            <input name="shortName" defaultValue={p.shortName} required minLength={2} maxLength={12} className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-fg-2">Website</span>
            <input name="siteUrl" type="url" defaultValue={p.siteUrl ?? ''} className={input} />
          </label>
          <label className="grid gap-1">
            <span className="text-fg-2">Order on screens</span>
            <input name="sort" type="number" min={1} max={999} defaultValue={p.sort} className={input} />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="text-fg-2">Description</span>
          <textarea name="description" rows={2} maxLength={1000} defaultValue={p.description} className={input} />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="sensitive"
            defaultChecked={p.sensitive}
            disabled={p.sensitive && (p.code === 'mho' || hasData)}
          />
          <span>
            Holds health or other special-category data
            {p.sensitive && (p.code === 'mho' || hasData) ? (
              <span className="text-fg-3"> (stays on: {p.code === 'mho' ? 'MHO holds health data' : 'the panel holds data'})</span>
            ) : null}
          </span>
        </label>
        {/* A disabled checkbox isn't submitted, so keep the locked value. */}
        {p.sensitive && (p.code === 'mho' || hasData) ? <input type="hidden" name="sensitive" value="on" /> : null}
        <label className="grid gap-1">
          <span className="text-fg-2">Reason (kept in the audit log)</span>
          <input name="reason" required minLength={5} maxLength={500} className={input} />
        </label>
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
    <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
      <button className={btn.secondary} disabled={pending} onClick={() => setEditing(true)}>
        Edit
      </button>
      {p.builtIn ? null : p.status === 'active' ? (
        <button className={btn.secondary} disabled={pending} onClick={() => run('archive')}>
          Archive
        </button>
      ) : (
        <button className={btn.secondary} disabled={pending} onClick={() => run('restore')}>
          Restore
        </button>
      )}
      {p.builtIn || hasData ? null : (
        <button className={btn.ghost + ' text-danger'} disabled={pending} onClick={() => run('delete')}>
          Delete
        </button>
      )}
    </div>
  );
}
