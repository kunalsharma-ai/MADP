'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ticketReplyAction, ticketStatusAction, ticketUpdateAction } from '@/app/panel-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

export function TicketActions({
  id,
  status,
  priority,
  assignedTo,
}: {
  id: string;
  status: string;
  priority: string;
  assignedTo: string;
}) {
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState(assignedTo);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
      after?.();
    });
  return (
    <Card>
      <CardHeader title="Reply" hint="The member sees a reply in their portal. No e-mail is sent." />
      <div className="grid gap-3 px-5 py-4 text-[13px]">
        <textarea
          className={`${input} min-h-28`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write to the member, or a note for the team"
        />
        <div className="flex flex-wrap gap-2">
          <button
            className={btn.primary}
            disabled={pending || text.trim().length < 2}
            onClick={() =>
              act(
                () => ticketReplyAction(id, text, false),
                'Reply posted to the member portal',
                () => setText(''),
              )
            }
          >
            Reply to member
          </button>
          <button
            className={btn.secondary}
            disabled={pending || text.trim().length < 2}
            onClick={() =>
              act(
                () => ticketReplyAction(id, text, true),
                'Internal note added',
                () => setText(''),
              )
            }
          >
            Internal note
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <label>
            Status
            <select
              className={input}
              defaultValue={status}
              onChange={(e) => act(() => ticketStatusAction(id, e.target.value), `Status: ${e.target.value}`)}
            >
              {['new', 'open', 'pending', 'resolved', 'closed'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              className={input}
              defaultValue={priority}
              onChange={(e) =>
                act(() => ticketUpdateAction(id, { priority: e.target.value }), `Priority: ${e.target.value}`)
              }
            >
              {['low', 'normal', 'high', 'urgent'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2">
            Assigned to
            <div className="flex gap-2">
              <input
                className={input}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="agent@yourcompany"
              />
              <button
                className={btn.secondary}
                disabled={pending}
                onClick={() => act(() => ticketUpdateAction(id, { assignedTo: assignee }), 'Assigned')}
              >
                Save
              </button>
            </div>
          </label>
        </div>
      </div>
    </Card>
  );
}
