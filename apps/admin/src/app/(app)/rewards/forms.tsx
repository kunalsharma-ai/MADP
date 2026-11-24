'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { catalogueCreateAction, offerCreateAction } from '@/app/step4-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

export function CatalogueForm() {
  const [pending, start] = useTransition();
  const empty = {
    key: '',
    kind: 'giftcard',
    title: '',
    subtitle: '',
    points: '',
    value: '',
    audience: 'adults',
  };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const audience =
    f.audience === 'adults' ? ['consumer', 'professional'] : f.audience === 'teen' ? ['teen'] : [f.audience];
  return (
    <Card>
      <CardHeader
        title="Add a reward"
        hint="Teens can only be offered learning rewards, and never see money values."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-7">
        <label>
          Key
          <input className={input} value={f.key} onChange={set('key')} placeholder="giftcard-25" />
        </label>
        <label>
          Kind
          <select className={input} value={f.kind} onChange={set('kind')}>
            {['giftcard', 'upi', 'paypal', 'charity', 'learning'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="md:col-span-2">
          Title
          <input className={input} value={f.title} onChange={set('title')} maxLength={80} />
        </label>
        <label>
          Points
          <input className={input} value={f.points} onChange={set('points')} inputMode="numeric" />
        </label>
        <label>
          For
          <select className={input} value={f.audience} onChange={set('audience')}>
            <option value="adults">Adults</option>
            <option value="consumer">Consumers</option>
            <option value="professional">Professionals</option>
            <option value="teen">Teens</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            className={btn.primary}
            disabled={pending || !f.key || !f.title || !Number(f.points)}
            onClick={() =>
              start(async () => {
                const r = await catalogueCreateAction({
                  key: f.key,
                  kind: f.kind,
                  title: f.title,
                  points: Number(f.points),
                  ...(f.value ? { value: Number(f.value) } : {}),
                  audience,
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success('Added to the catalogue');
                setF(empty);
              })
            }
          >
            Add
          </button>
        </div>
      </div>
    </Card>
  );
}

export function OfferForm() {
  const [pending, start] = useTransition();
  const empty = { title: '', multiplier: '2', startsAt: '', endsAt: '', reason: '' };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <CardHeader
        title="New bonus offer"
        hint="Multiplies survey points earned between the dates. 31 days at most."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-6">
        <label className="md:col-span-2">
          Title
          <input className={input} value={f.title} onChange={set('title')} maxLength={80} />
        </label>
        <label>
          Multiplier
          <input className={input} value={f.multiplier} onChange={set('multiplier')} inputMode="decimal" />
        </label>
        <label>
          Starts
          <input className={input} type="date" value={f.startsAt} onChange={set('startsAt')} />
        </label>
        <label>
          Ends
          <input className={input} type="date" value={f.endsAt} onChange={set('endsAt')} />
        </label>
        <label>
          Reason
          <input className={input} value={f.reason} onChange={set('reason')} />
        </label>
        <div className="md:col-span-6">
          <button
            className={btn.primary}
            disabled={pending || !f.title || !f.startsAt || !f.endsAt || f.reason.trim().length < 5}
            onClick={() =>
              start(async () => {
                const r = await offerCreateAction({
                  title: f.title,
                  multiplier: Number(f.multiplier),
                  startsAt: new Date(`${f.startsAt}T00:00:00Z`).toISOString(),
                  endsAt: new Date(`${f.endsAt}T23:59:59Z`).toISOString(),
                  reason: f.reason.trim(),
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success('Offer created');
                setF(empty);
              })
            }
          >
            Create offer
          </button>
        </div>
      </div>
    </Card>
  );
}
