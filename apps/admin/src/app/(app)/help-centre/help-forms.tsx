'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { helpSaveAction, helpStatusAction } from '@/app/panel-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

const TOPICS = [
  'start',
  'profiles',
  'surveys',
  'rewards',
  'quality',
  'activity',
  'referrals',
  'account',
  'settings',
  'pro',
  'teen',
  'support',
];
const TYPES = ['consumer', 'professional', 'teen'] as const;

/** Paragraphs are separated by a blank line; lines starting with "- " become a list, "> " a tip. */
function toBlocks(text: string): unknown[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lines = p.split('\n').map((l) => l.trim());
      if (lines.every((l) => l.startsWith('- '))) return { ul: lines.map((l) => l.slice(2)) };
      if (p.startsWith('> ')) return { note: p.slice(2) };
      return p;
    });
}

export function HelpEditor() {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('rewards');
  const [text, setText] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [keywords, setKeywords] = useState('');
  const save = () =>
    start(async () => {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
      const r = await helpSaveAction(null, {
        slug,
        topic,
        title,
        body: toBlocks(text),
        types,
        keywords: keywords.split(/[,\s]+/).filter(Boolean),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success('Saved as a draft');
      setTitle('');
      setText('');
    });
  return (
    <Card>
      <CardHeader
        title="New question"
        hint="Blank line between paragraphs. Lines starting with “- ” become a list, a paragraph starting with “> ” a tip."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-4">
        <label className="md:col-span-2">
          Question
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Topic
          <select className={input} value={topic} onChange={(e) => setTopic(e.target.value)}>
            {TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <fieldset>
          Shown to (none ticked = everyone)
          <div className="mt-2 flex gap-3">
            {TYPES.map((t) => (
              <label key={t} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={types.includes(t)}
                  onChange={(e) => setTypes((x) => (e.target.checked ? [...x, t] : x.filter((y) => y !== t)))}
                />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="md:col-span-4">
          Answer
          <textarea className={`${input} min-h-32`} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="md:col-span-3">
          Search words
          <input
            className={input}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="payout, paypal, late"
          />
        </label>
        <div className="flex items-end">
          <button
            className={btn.primary}
            disabled={pending || title.trim().length < 3 || !text.trim()}
            onClick={save}
          >
            Save draft
          </button>
        </div>
      </div>
    </Card>
  );
}

export function HelpStatusButtons({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const go = (s: string) =>
    start(async () => {
      const r = await helpStatusAction(id, s);
      if (!r.ok) return void toast.error(r.error);
      toast.success(s === 'published' ? 'Published to the member Help centre' : `Moved to ${s}`);
    });
  return (
    <div className="flex gap-1">
      {status !== 'published' ? (
        <button className={btn.ghost} disabled={pending} onClick={() => go('published')}>
          Publish
        </button>
      ) : null}
      {status === 'published' ? (
        <button className={btn.ghost} disabled={pending} onClick={() => go('archived')}>
          Archive
        </button>
      ) : null}
    </div>
  );
}
