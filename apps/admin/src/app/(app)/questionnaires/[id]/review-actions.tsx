'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { DraftStatus } from '@madp/contracts';
import { moveDraftAction, reviewDraftAction } from '@/app/questionnaire-actions';
import { btn, input } from '@/components/ui';

/** Screen 12: submit, a second admin's approve or reject, apply, discard. The buttons follow the API's rules. */
export function ReviewActions({
  id,
  status,
  canEdit,
  canPublish,
  own,
  errors,
  changes,
}: {
  id: string;
  status: DraftStatus;
  canEdit: boolean;
  canPublish: boolean;
  own: boolean;
  errors: number;
  changes: number;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const go = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      const applied = r.data as { ok?: boolean } | undefined;
      if (applied && applied.ok === false) return void toast.error('A write failed. See the steps above.');
      toast.success(done);
    });
  const rows: React.ReactNode[] = [];
  if (status === 'draft' && canEdit)
    rows.push(
      <button
        key="submit"
        className={btn.primary}
        disabled={pending || errors > 0 || changes === 0}
        title={errors ? 'Fix the checks first' : changes ? undefined : 'Nothing changes yet'}
        onClick={() => go(() => moveDraftAction(id, 'submit'), 'Sent for review')}
      >
        Send for review
      </button>,
    );
  if (status === 'review' && canPublish && !own)
    rows.push(
      <div key="review" className="grid w-full gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Note for the record (optional)"
          className={input}
        />
        <div className="flex gap-2">
          <button
            className={btn.primary}
            disabled={pending}
            onClick={() => go(() => reviewDraftAction(id, 'approve', note || undefined), 'Approved')}
          >
            Approve
          </button>
          <button
            className={`${btn.ghost} text-danger`}
            disabled={pending}
            onClick={() => go(() => reviewDraftAction(id, 'reject', note || undefined), 'Rejected')}
          >
            Reject
          </button>
        </div>
      </div>,
    );
  if (status === 'review' && own)
    rows.push(
      <p key="wait" className="text-fg-2">
        Waiting for a second admin with publish rights. You can&apos;t review your own draft.
      </p>,
    );
  if (status === 'approved' && canPublish)
    rows.push(
      <button
        key="apply"
        className={btn.primary}
        disabled={pending}
        onClick={() => go(() => moveDraftAction(id, 'apply'), 'Applied to the panel')}
      >
        Apply to the panel
      </button>,
    );
  if (['draft', 'review', 'approved'].includes(status) && canEdit)
    rows.push(
      <button
        key="discard"
        className={`${btn.ghost} text-danger`}
        disabled={pending}
        onClick={() => go(() => moveDraftAction(id, 'discard'), 'Discarded')}
      >
        Discard
      </button>,
    );
  if (!rows.length) return null;
  return <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 text-[13px]">{rows}</div>;
}
