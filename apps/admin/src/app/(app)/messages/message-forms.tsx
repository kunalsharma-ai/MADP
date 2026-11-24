'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  messageCreateAction,
  messagePreviewAction,
  messageSendAction,
  messageWithdrawAction,
} from '@/app/panel-actions';
import { Card, CardHeader, btn, fmt, input } from '@/components/ui';

export function MessageComposer() {
  const [pending, start] = useTransition();
  const [f, setF] = useState({ title: '', subtitle: '', body: '', cta: '', ctaLabel: '', segment: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const save = () =>
    start(async () => {
      const r = await messageCreateAction({
        title: f.title,
        body: f.body,
        ...(f.subtitle ? { subtitle: f.subtitle } : {}),
        ...(f.cta ? { cta: f.cta, ctaLabel: f.ctaLabel } : {}),
        ...(f.segment ? { filter: { categories: [f.segment] } } : {}),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success('Draft saved. Preview and send it from the list.');
      setF({ title: '', subtitle: '', body: '', cta: '', ctaLabel: '', segment: '' });
    });
  return (
    <Card>
      <CardHeader title="New message" hint="Saved as a draft. Links can only point inside the member area." />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-4">
        <label className="md:col-span-2">
          Title
          <input className={input} value={f.title} onChange={set('title')} maxLength={120} />
        </label>
        <label>
          From line (optional)
          <input className={input} value={f.subtitle} onChange={set('subtitle')} placeholder="Panel team" />
        </label>
        <label>
          Segment
          <select className={input} value={f.segment} onChange={set('segment')}>
            <option value="">All adults</option>
            <option value="b2c">Consumer (b2c)</option>
            <option value="b2b">Professional (b2b)</option>
            <option value="b2c-minor">Teen (b2c-minor)</option>
          </select>
        </label>
        <label className="md:col-span-4">
          Message
          <textarea className={`${input} min-h-24`} value={f.body} onChange={set('body')} maxLength={4000} />
        </label>
        <label className="md:col-span-2">
          Button link
          <input className={input} value={f.cta} onChange={set('cta')} placeholder="/member/surveys" />
        </label>
        <label>
          Button label
          <input className={input} value={f.ctaLabel} onChange={set('ctaLabel')} placeholder="See surveys" />
        </label>
        <div className="flex items-end">
          <button
            className={btn.primary}
            disabled={pending || !f.title.trim() || !f.body.trim()}
            onClick={save}
          >
            Save draft
          </button>
        </div>
      </div>
    </Card>
  );
}

export function MessageRowActions({
  id,
  status,
  audiences,
}: {
  id: string;
  status: string;
  audiences: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState('');
  const [reason, setReason] = useState('');
  const [pv, setPv] = useState<{ recipients: number; teens: number } | null>(null);
  if (status === 'sent')
    return (
      <button
        className={btn.ghost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await messageWithdrawAction(id, 'Withdrawn from the console');
            if (!r.ok) return void toast.error(r.error);
            toast.success('Withdrawn: it left members’ inboxes');
          })
        }
      >
        Withdraw
      </button>
    );
  if (status !== 'draft') return null;
  if (!open)
    return (
      <button className={btn.ghost} onClick={() => setOpen(true)}>
        Preview and send
      </button>
    );
  return (
    <div className="grid min-w-72 gap-2 text-[12px]">
      <select
        className={input}
        value={audience}
        onChange={(e) => {
          setAudience(e.target.value);
          setPv(null);
        }}
      >
        <option value="">The message's own segment</option>
        {audiences.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        className={btn.secondary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await messagePreviewAction(id, audience || undefined);
            if (!r.ok) return void toast.error(r.error);
            setPv(r.data);
          })
        }
      >
        Count recipients
      </button>
      {pv ? (
        <p>
          {fmt(pv.recipients)} members{pv.teens ? `, ${fmt(pv.teens)} of them teens` : ''}.
        </p>
      ) : null}
      <input
        className={input}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
      />
      <button
        className={btn.primary}
        disabled={pending || !pv || reason.trim().length < 5}
        onClick={() =>
          start(async () => {
            const r = await messageSendAction(id, reason, audience || undefined);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Sent to ${fmt(r.data.recipients)} member portals. No e-mail.`);
          })
        }
      >
        Send to portals
      </button>
    </div>
  );
}
