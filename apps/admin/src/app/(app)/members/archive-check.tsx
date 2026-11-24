'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { archiveRunAction } from '@/app/panel-actions';
import { Card, CardHeader, btn, fmt, input } from '@/components/ui';

type Run = { dryRun: boolean; months: number; checked: number; archived: number; activityUpdated: number };

/** Six-month activity check (Kunal, 24 Nov 2026): always shown as a dry run first; archiving needs a reason. */
export function ArchiveCheck() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Run | null>(null);
  const [reason, setReason] = useState('');
  const go = (dryRun: boolean) =>
    start(async () => {
      const r = await archiveRunAction(dryRun, dryRun ? undefined : reason);
      if (!r.ok) return void toast.error(r.error);
      setResult(r.data);
      toast.success(
        dryRun ? 'Dry run finished. Nothing was changed.' : `${fmt(r.data.archived)} members archived`,
      );
    });
  return (
    <Card>
      <CardHeader
        title="Six-month activity check"
        hint="Members with no sign-up, survey, profile answer or redemption in the brand's archive period move to Archived. They keep their points and answers and come back when they sign in."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn.secondary} disabled={pending} onClick={() => go(true)}>
            Dry run
          </button>
          <input
            className={`${input} max-w-sm`}
            placeholder="Reason, needed to archive for real"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className={btn.primary}
            disabled={pending || !result?.dryRun || reason.trim().length < 5}
            onClick={() => go(false)}
          >
            Archive now
          </button>
        </div>
        {result ? (
          <p>
            {result.dryRun ? 'Dry run: ' : 'Done: '}
            checked {fmt(result.checked)} members, {fmt(result.archived)}{' '}
            {result.dryRun ? 'would be' : 'were'} archived after {result.months} months without activity,{' '}
            {fmt(result.activityUpdated)} last-activity dates {result.dryRun ? 'would be' : 'were'} updated.
          </p>
        ) : (
          <p className="text-fg-3">Run the dry run first; &quot;Archive now&quot; unlocks after it.</p>
        )}
      </div>
    </Card>
  );
}
