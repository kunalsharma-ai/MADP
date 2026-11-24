'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { versionCreateAction, versionMoveAction } from '@/app/panel-actions';
import { Badge, Card, CardHeader, EmptyState, Table, btn, fmt, fmtDate, input } from '@/components/ui';

export interface Version {
  number: number;
  status: 'draft' | 'review' | 'published' | 'discarded';
  note: string;
  counts: { questions?: number };
  diff?: Partial<Record<'questions' | 'options' | 'profiles', Diff>>;
  createdBy: string;
  reviewRequestedBy?: string | null;
  publishedAt: string | null;
  createdAt: string;
}
type Diff = { added: number; removed: number; changed: number };
const d = (x?: Diff) => (x ? `+${x.added} −${x.removed} ~${x.changed}` : '—');
const TONE = { draft: 'neutral', review: 'warn', published: 'teal', discarded: 'danger' } as const;

/** Draft, review, then publish by a different admin (four eyes, checked by the panel). */
export function VersionActions({ versions, me }: { versions: Version[]; me: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const open = versions.find((v) => v.status === 'draft' || v.status === 'review');
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
    });
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="New version"
          hint="A version freezes the whole bank as it is now and shows what changed since the last published one. One open version at a time. The admin who drafted or reviewed it can't publish it."
        />
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <input
            className={`${input} max-w-md`}
            placeholder="What changed, in a line"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className={btn.primary}
            disabled={pending || Boolean(open)}
            onClick={() => act(() => versionCreateAction(note), 'Draft created')}
          >
            Create draft
          </button>
          {open ? (
            <span className="text-[13px] text-fg-3">
              Version {open.number} is still {open.status}.
            </span>
          ) : null}
        </div>
      </Card>
      <Card>
        <CardHeader title={`${versions.length} versions`} />
        {versions.length === 0 ? (
          <EmptyState title="No versions yet">Create the first draft once the bank is imported.</EmptyState>
        ) : (
          <Table
            head={[
              'Version',
              'Status',
              'Note',
              'Questions',
              'Question changes',
              'Option changes',
              'Profile changes',
              'Date',
              '',
            ]}
          >
            {versions.map((v) => (
              <tr key={v.number}>
                <td className="num px-5 py-2.5 font-medium">v{v.number}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={TONE[v.status]}>{v.status}</Badge>
                </td>
                <td className="px-5 py-2.5">{v.note || '—'}</td>
                <td className="num px-5 py-2.5">{fmt(v.counts?.questions)}</td>
                <td className="px-5 py-2.5 font-mono text-[12px] text-fg-2">{d(v.diff?.questions)}</td>
                <td className="px-5 py-2.5 font-mono text-[12px] text-fg-2">{d(v.diff?.options)}</td>
                <td className="px-5 py-2.5 font-mono text-[12px] text-fg-2">{d(v.diff?.profiles)}</td>
                <td className="px-5 py-2.5">{fmtDate(v.publishedAt ?? v.createdAt)}</td>
                <td className="px-5 py-2.5">
                  <div className="flex gap-1">
                    {v.status === 'draft' ? (
                      <button
                        className={btn.ghost}
                        disabled={pending}
                        onClick={() => act(() => versionMoveAction(v.number, 'review'), 'Sent for review')}
                      >
                        Send for review
                      </button>
                    ) : null}
                    {v.status === 'review' && (v.createdBy === me || v.reviewRequestedBy === me) ? (
                      <span className="self-center text-[12px] text-fg-3">Another admin publishes</span>
                    ) : null}
                    {v.status === 'review' && v.createdBy !== me && v.reviewRequestedBy !== me ? (
                      <button
                        className={btn.ghost}
                        disabled={pending}
                        onClick={() => act(() => versionMoveAction(v.number, 'publish'), 'Published')}
                      >
                        Publish
                      </button>
                    ) : null}
                    {v.status === 'draft' || v.status === 'review' ? (
                      <button
                        className={btn.ghost}
                        disabled={pending}
                        onClick={() => act(() => versionMoveAction(v.number, 'discard'), 'Discarded')}
                      >
                        Discard
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
