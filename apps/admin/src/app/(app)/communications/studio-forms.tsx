'use client';
import { panelName, panelShort } from '@/lib/panel-names';
import { usePanels } from '@/components/panels-context';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CampaignKind } from '@madp/contracts';
import { addTemplateVersion, campaignAction, createCampaignAction, createTemplateAction, versionAction } from '../../actions';
import { btn } from '@/components/ui';

const field = 'rounded-md border border-border bg-surface px-2 py-1 text-[12px]';

function useAct() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      try {
        const r = await fn();
        toast.success(typeof r === 'string' ? r : ok);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, act };
}

export function NewTemplate() {
  const panelList = usePanels();
  const [open, setOpen] = useState(false);
  const { pending, act } = useAct();
  if (!open)
    return (
      <button className={btn.secondary} onClick={() => setOpen(true)}>
        New template
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      action={(f) =>
        act(
          () => createTemplateAction(String(f.get('panel')), String(f.get('key')), String(f.get('name')), String(f.get('kind'))),
          'Template created',
        )
      }
    >
      <select name="panel" className={field} aria-label="Panel">
        {panelList.map((x) => x.code).map((p) => (
          <option key={p} value={p}>
            {panelShort(p, panelList)}
          </option>
        ))}
      </select>
      <select name="kind" className={field} aria-label="Kind">
        {CampaignKind.options.map((k) => (
          <option key={k} value={k}>
            {k.replace('_', ' ')}
          </option>
        ))}
      </select>
      <input name="key" required placeholder="key-like-this" pattern="[a-z0-9][a-z0-9-]{1,62}" className={field} aria-label="Key" />
      <input name="name" required minLength={2} placeholder="Name" className={field} aria-label="Name" />
      <button className={btn.primary} disabled={pending}>
        Create
      </button>
    </form>
  );
}

export function NewVersion({ templateId }: { templateId: string }) {
  const [open, setOpen] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const { pending, act } = useAct();
  if (!open)
    return (
      <button className={`${btn.ghost} mt-2`} onClick={() => setOpen(true)}>
        New version…
      </button>
    );
  return (
    <form
      className="mt-2 grid gap-1.5"
      action={(f) =>
        act(async () => {
          const r = await addTemplateVersion(templateId, String(f.get('subject')), String(f.get('html')), String(f.get('text')));
          setProblems(r.problems);
          return r.problems.length ? 'Saved as a draft; fix the problems before review' : 'Draft saved';
        }, 'Draft saved')
      }
    >
      <input name="subject" required placeholder="Subject" className={field} aria-label="Subject" />
      <textarea name="html" required rows={4} placeholder="HTML. Placeholders: {{firstName}} {{panelName}} {{unsubscribeUrl}} {{preferencesUrl}} {{profileUrl}}" className={`${field} font-mono`} aria-label="HTML body" />
      <textarea name="text" required rows={3} placeholder="Plain-text version" className={`${field} font-mono`} aria-label="Text body" />
      {problems.length ? (
        <ul className="text-[12px] text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <button className={btn.primary} disabled={pending}>
        Save draft
      </button>
    </form>
  );
}

export function VersionButtons({ id, status }: { id: string; status: string }) {
  const { pending, act } = useAct();
  return (
    <span className="flex gap-1">
      <a className={btn.ghost} href={`/communications/preview/${id}`}>
        Preview
      </a>
      {status === 'draft' || status === 'rejected' ? (
        <button className={btn.secondary} disabled={pending} onClick={() => act(() => versionAction(id, 'submit'), 'Sent for review')}>
          Submit
        </button>
      ) : null}
      {status === 'in_review' ? (
        <>
          <button className={btn.primary} disabled={pending} onClick={() => act(() => versionAction(id, 'approve'), 'Approved')}>
            Approve
          </button>
          <button className={btn.ghost} disabled={pending} onClick={() => act(() => versionAction(id, 'reject'), 'Rejected')}>
            Reject
          </button>
        </>
      ) : null}
    </span>
  );
}

export function NewCampaign({ versions }: { versions: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const { pending, act } = useAct();
  if (!versions.length) return null;
  if (!open)
    return (
      <button className={btn.secondary} onClick={() => setOpen(true)}>
        New campaign
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      action={(f) => act(() => createCampaignAction(String(f.get('name')), String(f.get('version'))), 'Campaign drafted')}
    >
      <input name="name" required minLength={2} placeholder="Campaign name" className={field} aria-label="Campaign name" />
      <select name="version" className={field} aria-label="Template version">
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <button className={btn.primary} disabled={pending}>
        Create
      </button>
    </form>
  );
}

export function CampaignButtons({ id, status }: { id: string; status: string }) {
  const { pending, act } = useAct();
  const go = (a: Parameters<typeof campaignAction>[1], ok: string) => act(() => campaignAction(id, a), ok);
  return (
    <span className="flex gap-1">
      {status === 'draft' ? (
        <button className={btn.primary} disabled={pending} onClick={() => go('approve', 'Approved')}>
          Approve
        </button>
      ) : null}
      {status === 'approved' ? (
        <>
          <button className={btn.primary} disabled={pending} onClick={() => go('dry_run', 'Dry run finished')}>
            Dry run
          </button>
          <button className={btn.ghost} disabled={pending} onClick={() => go('pause', 'Paused')}>
            Pause
          </button>
        </>
      ) : null}
      {status === 'paused' ? (
        <button className={btn.secondary} disabled={pending} onClick={() => go('resume', 'Resumed')}>
          Resume
        </button>
      ) : null}
    </span>
  );
}
