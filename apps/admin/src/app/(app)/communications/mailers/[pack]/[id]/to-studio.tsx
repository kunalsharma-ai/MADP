'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { mailerToStudioAction } from '../../../../../actions';
import { btn } from '@/components/ui';

/** Picks a subject line and makes a draft studio version from this mailer. Nothing is sent. */
export function ToStudio({ pack, id, panel, subjects }: { pack: string; id: string; panel: string; subjects: string[] }) {
  const [subject, setSubject] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 px-5 py-3 text-[13px]">
      <label className="grid gap-1">
        <span className="text-fg-3">Subject line</span>
        <select className="rounded-md border border-border bg-surface px-2 py-1 text-[12px]" value={subject} onChange={(e) => setSubject(Number(e.target.value))}>
          {subjects.map((s, i) => (
            <option key={i} value={i}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={btn.primary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                const msg = await mailerToStudioAction(pack, id, panel, subject);
                setDone(msg);
                toast.success(msg);
              } catch (e) {
                toast.error((e as Error).message);
              }
            })
          }
        >
          {pending ? 'Making…' : 'Make a studio template'}
        </button>
        {done ? (
          <Link href="/communications" className="text-accent underline">
            Open the studio to review it
          </Link>
        ) : null}
      </div>
    </div>
  );
}
