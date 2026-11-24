'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ideaAction, storyCreateAction, storyPublishAction, taskCreateAction } from '@/app/step4-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

export function PollForm() {
  const [pending, start] = useTransition();
  const empty = { title: '', question: '', day: '', options: '', points: '5' };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const options = f.options
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <Card>
      <CardHeader
        title="Schedule a daily poll"
        hint="For adult members. On a day with nothing scheduled, a poll is taken from the built-in rotation."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-6">
        <label className="md:col-span-2">
          Title
          <input className={input} value={f.title} onChange={set('title')} maxLength={120} />
        </label>
        <label className="md:col-span-2">
          Question
          <input className={input} value={f.question} onChange={set('question')} maxLength={300} />
        </label>
        <label>
          Day
          <input className={input} type="date" value={f.day} onChange={set('day')} />
        </label>
        <label>
          Points
          <input className={input} value={f.points} onChange={set('points')} inputMode="numeric" />
        </label>
        <label className="md:col-span-5">
          Options, one per line
          <textarea className={`${input} min-h-20`} value={f.options} onChange={set('options')} />
        </label>
        <div className="flex items-end">
          <button
            className={btn.primary}
            disabled={pending || !f.title || !f.day || options.length < 2}
            onClick={() =>
              start(async () => {
                const r = await taskCreateAction({
                  kind: 'poll',
                  title: f.title,
                  ...(f.question ? { question: f.question } : {}),
                  day: f.day,
                  points: Number(f.points) || 0,
                  audience: ['consumer', 'professional'],
                  options: options.map((label) => ({ label })),
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success('Poll scheduled');
                setF(empty);
              })
            }
          >
            Schedule
          </button>
        </div>
      </div>
    </Card>
  );
}

export function StoryForm() {
  const [pending, start] = useTransition();
  const empty = { title: '', summary: '', body: '' };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <CardHeader
        title="Write a story"
        hint="“Your opinion mattered”: aggregates only, never about one member. Saved unpublished."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-4">
        <label className="md:col-span-2">
          Title
          <input className={input} value={f.title} onChange={set('title')} maxLength={140} />
        </label>
        <label className="md:col-span-2">
          Summary
          <input className={input} value={f.summary} onChange={set('summary')} maxLength={400} />
        </label>
        <label className="md:col-span-3">
          Story
          <textarea className={`${input} min-h-20`} value={f.body} onChange={set('body')} maxLength={8000} />
        </label>
        <div className="flex items-end">
          <button
            className={btn.primary}
            disabled={pending || !f.title}
            onClick={() =>
              start(async () => {
                const r = await storyCreateAction({
                  type: 'story',
                  title: f.title,
                  ...(f.summary ? { summary: f.summary } : {}),
                  ...(f.body ? { body: f.body } : {}),
                  audience: ['consumer', 'professional'],
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success('Saved. Publish it from the list.');
                setF(empty);
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </Card>
  );
}

export function PublishToggle({ id, published }: { id: string; published: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={btn.ghost}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await storyPublishAction(id, !published);
          if (!r.ok) return void toast.error(r.error);
          toast.success(published ? 'Unpublished' : 'Published');
        })
      }
    >
      {published ? 'Unpublish' : 'Publish'}
    </button>
  );
}

export function IdeaButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const go = (status: 'approved' | 'rejected') =>
    start(async () => {
      const r = await ideaAction(id, status);
      if (!r.ok) return void toast.error(r.error);
      toast.success(status === 'approved' ? 'Approved: points paid' : 'Rejected');
    });
  return (
    <div className="flex gap-1">
      <button className={btn.ghost} disabled={pending} onClick={() => go('approved')}>
        Approve
      </button>
      <button className={`${btn.ghost} text-danger`} disabled={pending} onClick={() => go('rejected')}>
        Reject
      </button>
    </div>
  );
}
