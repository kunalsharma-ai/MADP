'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { verifyAuditAction } from '@/app/super-admin-actions';
import { btn } from '@/components/ui';

export function VerifyChain() {
  const [pending, start] = useTransition();
  return (
    <button
      className={btn.secondary}
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const r = await verifyAuditAction();
            if (r.ok) toast.success(`Hash chain intact: ${r.checked.toLocaleString()} entries checked`);
            else toast.error(`Chain broken at entry ${r.firstBrokenId} (${r.problem?.replaceAll('_', ' ')})`);
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      {pending ? 'Checking…' : 'Check hash chain'}
    </button>
  );
}
