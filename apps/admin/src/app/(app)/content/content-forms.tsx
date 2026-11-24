'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ContentBody } from '@madp/contracts';
import { contentCreateAction, contentMoveAction, contentRestoreAction, contentSaveAction } from '@/app/panel-actions';
import { ContentView } from '@/components/content-view';
import { Card, CardHeader, btn, input } from '@/components/ui';
import { blocksToText, textToBlocks } from '@/lib/content-blocks';
import { KEY_LABEL } from './shared';

const HELP = 'Blank line between paragraphs. “## ” heading, “### ” sub-heading, “- ” list, “1. ” numbered list, “> ” note, “| a | b |” table rows (first row is the header). Write links as plain https:// or e-mail addresses.';

function useBody(text: string) {
  return useMemo(() => {
    const blocks = textToBlocks(text);
    const r = ContentBody.safeParse(blocks);
    return { blocks, problem: text.trim() && !r.success ? r.error.issues[0]?.message ?? 'Check the text' : null };
  }, [text]);
}

export function NewPage({ missingLegal }: { missingLegal: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [key, setKey] = useState(missingLegal[0] ?? '');
  const [lang, setLang] = useState('en');
  const [title, setTitle] = useState(KEY_LABEL[missingLegal[0] ?? ''] ?? '');
  const [text, setText] = useState('');
  const body = useBody(text);
  const create = () =>
    start(async () => {
      const r = await contentCreateAction({ key, lang, title, body: body.blocks });
      if (!r.ok) return void toast.error(r.error);
      toast.success('Draft saved. Nothing is live until it is published.');
      router.push(`/content/${r.data.id}`);
    });
  return (
    <Card>
      <CardHeader title="New page" hint={HELP} />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-4">
        <label>
          Page key
          <input
            className={input}
            list="content-keys"
            value={key}
            onChange={(e) => {
              setKey(e.target.value.toLowerCase());
              if (KEY_LABEL[e.target.value]) setTitle(KEY_LABEL[e.target.value]!);
            }}
            placeholder="privacy, terms, about-us"
          />
          <datalist id="content-keys">
            {Object.keys(KEY_LABEL).map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
        <label>
          Language
          <input className={input} value={lang} onChange={(e) => setLang(e.target.value)} />
        </label>
        <label className="md:col-span-2">
          Title
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="md:col-span-4">
          Text
          <textarea className={`${input} min-h-40 font-mono text-[12px]`} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="text-[12px] text-fg-3 md:col-span-3">
          {['privacy', 'terms', 'gdpr', 'cookies'].includes(key)
            ? 'A legal page: after review, a second admin who did not edit it publishes it.'
            : 'An ordinary page: you can publish it yourself.'}
          {body.problem ? <span className="ml-2 text-danger">{body.problem}</span> : null}
        </p>
        <div className="flex items-end justify-end">
          <button className={btn.primary} disabled={pending || !key || !title.trim() || !text.trim() || !!body.problem} onClick={create}>
            Save draft
          </button>
        </div>
      </div>
    </Card>
  );
}

export function PageEditor({
  id,
  kind,
  me,
  draft,
  live,
}: {
  id: string;
  kind: 'legal' | 'page';
  me: string;
  draft: { state: 'editing' | 'review'; title: string; body: unknown[]; updatedBy: string; reviewRequestedBy: string | null } | null;
  live: { title: string; body: unknown[] } | null;
}) {
  const [pending, start] = useTransition();
  const base = draft ?? live;
  const [title, setTitle] = useState(base?.title ?? '');
  const [text, setText] = useState(base ? blocksToText(base.body) : '');
  const body = useBody(text);
  const dirty = !!base && (title !== base.title || text !== blocksToText(base.body));
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(msg);
    });
  const legal = kind === 'legal';
  const mine = !!draft && (draft.updatedBy === me || draft.reviewRequestedBy === me);
  const canPublish = !!draft && !dirty && (!legal || (draft.state === 'review' && !mine));
  const why = !draft
    ? null
    : dirty
      ? 'Save the draft first.'
      : legal && draft.state !== 'review'
        ? 'A legal page is published from review. Ask for review first.'
        : legal && mine
          ? 'You edited this draft or asked for its review, so a second admin publishes it.'
          : null;
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title={draft ? (draft.state === 'review' ? 'Draft in review' : 'Draft') : 'Edit (starts a draft)'} hint={HELP} />
        <div className="grid gap-3 px-5 py-4 text-[13px]">
          <label>
            Title
            <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Text
            <textarea className={`${input} min-h-96 font-mono text-[12px]`} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {body.problem ? <p className="text-danger">{body.problem}</p> : null}
          {draft?.state === 'review' && dirty ? <p className="text-warn">Saving sends the draft back to editing; review is asked again.</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={btn.secondary}
              disabled={pending || !dirty || !title.trim() || !text.trim() || !!body.problem}
              onClick={() => act(() => contentSaveAction(id, { title, body: body.blocks }), 'Draft saved')}
            >
              Save draft
            </button>
            {draft?.state === 'editing' ? (
              <button className={btn.secondary} disabled={pending || dirty} onClick={() => act(() => contentMoveAction(id, 'review'), 'Sent for review')}>
                Ask for review
              </button>
            ) : null}
            {draft ? (
              <button className={btn.primary} disabled={pending || !canPublish} onClick={() => act(() => contentMoveAction(id, 'publish'), 'Published. The site shows it now.')}>
                Publish
              </button>
            ) : null}
            {draft ? (
              <button className={btn.ghost} disabled={pending} onClick={() => act(() => contentMoveAction(id, 'discard'), 'Draft discarded. The live page is unchanged.')}>
                Discard draft
              </button>
            ) : null}
          </div>
          {why ? <p className="text-[12px] text-fg-3">{why}</p> : null}
        </div>
      </Card>
      <Card>
        <CardHeader title="Preview" hint="How the site shows this text. Nothing here is read as HTML." />
        <div className="px-5 py-4">
          {body.blocks.length ? <ContentView title={title} body={body.blocks} /> : <p className="text-fg-3">Nothing to show yet.</p>}
        </div>
      </Card>
    </div>
  );
}

export function RestoreButton({ id, version }: { id: string; version: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={btn.ghost}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await contentRestoreAction(id, version);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`Version ${version} copied into the draft. Publish it the usual way to roll back.`);
        })
      }
    >
      Copy into draft
    </button>
  );
}
