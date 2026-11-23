'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { retryDeadLetters, runImport } from '../../actions';
import { btn } from '@/components/ui';

export function ImportButtons({ panel }: { panel: string }) {
  const [pending, start] = useTransition();
  const go = (dryRun: boolean) =>
    start(async () => {
      try {
        const r = await runImport(panel, dryRun);
        const n = r.counts as Record<string, number>;
        if (r.status === 'succeeded')
          toast.success(
            `${panel.toUpperCase()} ${dryRun ? 'dry run' : 'import'} finished: ${n.respondentsSeen} respondents, ${n.questions} questions${dryRun ? ' (nothing written)' : ''}`,
          );
        else toast.error(`${panel.toUpperCase()} import failed: ${r.error ?? 'unknown error'}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return (
    <div className="flex gap-2 pt-1">
      <button className={btn.secondary} disabled={pending} onClick={() => go(true)}>
        Dry run
      </button>
      <button className={btn.primary} disabled={pending} onClick={() => go(false)}>
        {pending ? 'Running…' : 'Run import'}
      </button>
    </div>
  );
}

export function RetryDeadLettersButton({ panel }: { panel: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={btn.secondary}
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const r = await retryDeadLetters(panel);
            if (r.stillOpen) toast.warning(`${r.resolved} resolved, ${r.stillOpen} still failing`);
            else toast.success(`${r.resolved} batch(es) re-imported`);
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      {pending ? 'Retrying…' : 'Retry now'}
    </button>
  );
}
