'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { surveyCreateAction } from '@/app/panel-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

export function NewSurvey() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    name: '',
    slug: '',
    category: 'b2c',
    source: '',
    points: '100',
    loi: '10',
    link: '',
    minQualityScore: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const create = () =>
    start(async () => {
      const r = await surveyCreateAction({
        name: f.name,
        slug:
          f.slug ||
          f.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        category: f.category,
        source: f.source,
        points: Number(f.points),
        loi: Number(f.loi),
        ...(f.link ? { link: f.link } : {}),
        ...(f.minQualityScore ? { minQualityScore: Number(f.minQualityScore) } : {}),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success('Draft survey created');
      router.push(`/surveys/${r.data.id}`);
    });
  return (
    <Card>
      <CardHeader title="New survey" hint="Starts as a draft. It needs a link before it can go live." />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-4">
        <label className="md:col-span-2">
          Name
          <input className={input} value={f.name} onChange={set('name')} />
        </label>
        <label>
          Slug
          <input className={input} value={f.slug} onChange={set('slug')} placeholder="from the name" />
        </label>
        <label>
          Segment
          <select className={input} value={f.category} onChange={set('category')}>
            <option value="b2c">Consumer (b2c)</option>
            <option value="b2b">Business Professional (b2b)</option>
            <option value="b2c-minor">Teen (b2c-minor)</option>
          </select>
        </label>
        <label>
          Source (client or supplier)
          <input className={input} value={f.source} onChange={set('source')} />
        </label>
        <label>
          Points
          <input className={input} type="number" value={f.points} onChange={set('points')} />
        </label>
        <label>
          Length (minutes)
          <input className={input} type="number" value={f.loi} onChange={set('loi')} />
        </label>
        <label>
          Minimum quality score
          <input
            className={input}
            type="number"
            value={f.minQualityScore}
            onChange={set('minQualityScore')}
            placeholder="none"
          />
        </label>
        <label className="md:col-span-3">
          Survey link (https)
          <input className={input} value={f.link} onChange={set('link')} />
        </label>
        <div className="flex items-end">
          <button className={btn.primary} disabled={pending || !f.name || !f.source} onClick={create}>
            Create draft
          </button>
        </div>
      </div>
    </Card>
  );
}
