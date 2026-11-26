'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { helpSaveAction, helpStatusAction } from '@/app/panel-actions';
import { Badge, Card, CardHeader, btn, input } from '@/components/ui';
import { HelpCreate, type ParsedTable } from '@madp/contracts';
import { DownloadMenu, UploadButton, mapHeader } from '@/components/files';

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
      if (lines.every((l) => /^\d+\.\s/.test(l))) return { ol: lines.map((l) => l.replace(/^\d+\.\s+/, '')) };
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

const HELP_COLS = {
  title: ['question', 'title'],
  answer: ['answer', 'body', 'text'],
  topic: ['topic'],
  types: ['shown to', 'for', 'members'],
  keywords: ['keywords', 'tags'],
};
type HelpRow = {
  row: number;
  data: Record<string, unknown> | null;
  title: string;
  problem: string | null;
  state?: 'saved' | string;
};

/** One spreadsheet row as a help entry: paragraphs split on blank lines, "- " lines a list, "> " a tip. */
function helpRows(t: ParsedTable): { rows: HelpRow[]; problem: string | null } {
  const [head = [], ...body] = t.sheets[0]?.rows ?? [];
  const { index, missing } = mapHeader(head, HELP_COLS);
  if (missing.includes('title') || missing.includes('answer'))
    return {
      rows: [],
      problem:
        'The first sheet needs a Question and an Answer column. Download the template to get the layout.',
    };
  const cell = (r: string[], k: keyof typeof HELP_COLS) =>
    index[k] === undefined ? '' : (r[index[k]!] ?? '').trim();
  const rows = body.slice(0, 200).map((r, i): HelpRow => {
    const title = cell(r, 'title');
    const topic = (cell(r, 'topic') || 'start').toLowerCase();
    const types = cell(r, 'types')
      .toLowerCase()
      .split(/[,;\s]+/)
      .filter(Boolean);
    const data = {
      slug: title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80),
      topic,
      title,
      body: toBlocks(cell(r, 'answer').replace(/\r\n/g, '\n')),
      types: types.includes('everyone') || types.includes('all') ? [] : types,
      keywords: cell(r, 'keywords')
        .toLowerCase()
        .split(/[,;\s]+/)
        .filter(Boolean)
        .slice(0, 30),
    };
    const ok = HelpCreate.safeParse(data);
    const issue = ok.success ? null : ok.error.issues[0];
    return {
      row: i + 2,
      title: title || '(no question)',
      data: ok.success ? ok.data : null,
      problem: issue ? `${issue.path.join('.') || 'row'}: ${issue.message}` : null,
    };
  });
  return {
    rows,
    problem: body.length > 200 ? 'Only the first 200 rows are read. Split bigger files.' : null,
  };
}

/**
 * Upload many help questions from Excel or CSV. A preview checks every row first; saving adds them as drafts (members
 * see nothing until each one is published), one audited call per entry.
 */
export function HelpImport() {
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState<{ name: string; rows: HelpRow[]; problem: string | null } | null>(null);
  const good = plan?.rows.filter((r) => r.data && !r.state) ?? [];
  const save = () =>
    start(async () => {
      const next = [...(plan?.rows ?? [])];
      for (const r of good) {
        const res = await helpSaveAction(null, r.data!);
        const i = next.findIndex((x) => x.row === r.row);
        next[i] = { ...r, state: res.ok ? 'saved' : res.error };
      }
      setPlan((p) => (p ? { ...p, rows: next } : p));
      const bad = next.filter((r) => r.state && r.state !== 'saved').length;
      if (bad) toast.error(`${good.length - bad} saved as drafts, ${bad} refused`);
      else toast.success(`${good.length} help questions saved as drafts. Publish each one when it is ready.`);
    });
  return (
    <Card>
      <CardHeader
        title="Add many questions from Excel"
        hint="Each row becomes a draft. Members see nothing until you publish it."
        action={
          <span className="flex flex-wrap items-center gap-2">
            <DownloadMenu
              screen="help_centre"
              label="Template"
              title="Help centre upload template"
              subtitle="One row per question. Topic is one of: start, profiles, surveys, rewards, quality, activity, referrals, account, settings, pro, teen, support. Shown to: consumer, professional, teen, or everyone."
              formats={['xlsx', 'csv']}
              info={false}
              columns={[
                { key: 'title', label: 'Question' },
                { key: 'answer', label: 'Answer' },
                { key: 'topic', label: 'Topic' },
                { key: 'types', label: 'Shown to' },
                { key: 'keywords', label: 'Keywords' },
              ]}
              rows={[
                {
                  title: 'DEMO: How do I redeem my points?',
                  answer:
                    'Open Rewards and pick a reward.\n\n- Points show after a survey is approved.\n- Payouts are made by hand.',
                  topic: 'rewards',
                  types: 'everyone',
                  keywords: 'redeem, points',
                },
              ]}
            />
            <UploadButton
              kind="table"
              title="Upload help questions"
              help={{
                why: 'Add a full FAQ at once instead of typing each question.',
                where:
                  'Use the Template: Question, Answer, Topic, Shown to, Keywords. In the answer, a blank line starts a new paragraph, "- " lines become a list, "> " a tip.',
                how: [
                  'Fill the template and upload it.',
                  'Check the preview: rows with a problem are left out.',
                  'Press Save as drafts, then publish each question from the list below.',
                ],
              }}
              onParsed={(t, name) => setPlan({ name, ...helpRows(t) })}
            />
          </span>
        }
      />
      {plan ? (
        <div className="rise grid gap-2 px-5 py-4 text-[13px]">
          <p>
            <strong>Preview of {plan.name}, nothing saved yet:</strong>{' '}
            {plan.rows.filter((r) => r.data).length} ready, {plan.rows.filter((r) => !r.data).length} with a
            problem.
          </p>
          {plan.problem ? <p className="text-danger">{plan.problem}</p> : null}
          {plan.rows.length ? (
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wider text-fg-3">
                  <tr>
                    <th className="px-3 py-1.5">Row</th>
                    <th className="px-3 py-1.5">Question</th>
                    <th className="px-3 py-1.5">Topic</th>
                    <th className="px-3 py-1.5">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plan.rows.map((r) => (
                    <tr key={r.row}>
                      <td className="px-3 py-1.5 text-fg-3">{r.row}</td>
                      <td className="max-w-sm truncate px-3 py-1.5">{r.title}</td>
                      <td className="px-3 py-1.5">{String(r.data?.topic ?? '')}</td>
                      <td className="px-3 py-1.5">
                        {r.state === 'saved' ? (
                          <Badge tone="teal">saved as draft</Badge>
                        ) : r.state ? (
                          <Badge tone="danger">{r.state}</Badge>
                        ) : r.problem ? (
                          <Badge tone="danger">{r.problem}</Badge>
                        ) : (
                          <Badge>ready</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className={btn.primary} disabled={pending || !good.length} onClick={save}>
              {pending ? 'Saving…' : `Save ${good.length} as drafts`}
            </button>
            <button type="button" className={btn.ghost} onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
