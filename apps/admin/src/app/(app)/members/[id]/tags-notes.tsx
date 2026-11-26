'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Pin, Plus, StickyNote, Tag, Trash2, X } from 'lucide-react';
import type { MemberNote } from '@madp/contracts';
import { addMemberNoteAction, deleteMemberNoteAction, setMemberTagsAction } from '@/app/member-views-actions';
import { TopicInfo } from '@/components/screen-info';
import { tagTint } from '../shared';

/** Tags and notes on one member, kept in MADP for this brand. Everyone with Members access reads; editors change. */
export function TagsNotes({
  member,
  tags,
  notes,
  known,
  canEdit,
}: {
  member: string;
  tags: string[];
  notes: MemberNote[];
  /** Tags already used on this brand, offered as suggestions. */
  known: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tag, setTag] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);

  const saveTags = (next: string[]) =>
    start(async () => {
      const r = await setMemberTagsAction(member, next);
      if (!r.ok) return void toast.error(r.error);
      setTag('');
      router.refresh();
    });
  const addTag = () => {
    const t = tag.trim().toLowerCase();
    if (t && !tags.includes(t)) saveTags([...tags, t]);
  };
  const addNote = () =>
    start(async () => {
      const r = await addMemberNoteAction(member, body.trim(), pinned);
      if (!r.ok) return void toast.error(r.error);
      setBody('');
      setPinned(false);
      router.refresh();
    });
  const removeNote = (id: string) =>
    start(async () => {
      const r = await deleteMemberNoteAction(member, id);
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });

  return (
    <section aria-label="Tags and notes" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
      <div className="flex items-center gap-2 bg-gradient-to-r from-[#f59e0b] via-[#f97316] to-[#ec4899] px-4 py-2.5 text-white">
        <StickyNote className="size-4" aria-hidden />
        <h2 className="text-[14px] font-bold">Tags and notes</h2>
        <TopicInfo
          title="Tags and notes"
          help={{
            why: 'Mark members for follow-up ("vip", "check payout") and keep what the team learned about them in one place.',
            where: 'Kept in MADP for this brand only, never sent to the panel or the member. Opening notes is in the audit log.',
            how: [
              'Type a tag and press Enter. Filter the Members table by a tag with the Tag box above the table.',
              'Write a note and press Add. Pin the ones everyone should see first.',
              'Only the person who wrote a note can delete it. Keep notes factual: members can ask to see their data.',
            ],
          }}
        />
      </div>
      <div className="grid gap-3 p-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="size-3.5 text-fg-3" aria-hidden />
          {tags.length === 0 ? <span className="text-[12px] text-fg-3">No tags yet.</span> : null}
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-white shadow-sm"
              style={{ background: tagTint(t) }}
            >
              {t}
              {canEdit ? (
                <button type="button" disabled={pending} onClick={() => saveTags(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="rounded-full opacity-80 hover:opacity-100">
                  <X className="size-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {canEdit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTag();
            }}
            className="flex gap-2"
          >
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value.toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 30))}
              list={`tags-${member}`}
              placeholder="Add a tag, e.g. vip"
              aria-label="New tag"
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-[13px]"
            />
            <datalist id={`tags-${member}`}>
              {known.filter((k) => !tags.includes(k)).map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <button disabled={pending || !tag.trim() || tags.length >= 10} className="inline-flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
              <Plus className="size-3.5" aria-hidden /> Tag
            </button>
          </form>
        ) : null}
        <div className="grid gap-2 border-t border-border pt-3">
          {notes.length === 0 ? <p className="text-[12px] text-fg-3">No notes yet.</p> : null}
          {notes.map((n) => (
            <article key={n.id} className={`rounded-xl border p-2.5 ${n.pinned ? 'border-[#f59e0b]/50 bg-[color-mix(in_oklab,#f59e0b_8%,transparent)]' : 'border-border bg-surface-2/40'}`}>
              <p className="whitespace-pre-wrap break-words text-fg">{n.body}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-3">
                {n.pinned ? <Pin className="size-3 text-[#f59e0b]" aria-label="Pinned" /> : null}
                <span>
                  {n.author ?? 'Former admin'} · {new Date(n.createdAt).toLocaleString()}
                </span>
                {n.mine && canEdit ? (
                  <button type="button" disabled={pending} onClick={() => removeNote(n.id)} aria-label="Delete note" className="ml-auto rounded p-0.5 hover:text-danger">
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          {canEdit ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addNote();
              }}
              className="grid gap-2"
            >
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 2000))}
                rows={3}
                placeholder="What should the team know about this member?"
                aria-label="New note"
                className="rounded-xl border border-border bg-surface px-3 py-2 text-[13px]"
              />
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin
                </label>
                <button disabled={pending || body.trim().length < 2} className="ml-auto inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-[#f59e0b] to-[#ec4899] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm disabled:opacity-50">
                  <Plus className="size-3.5" aria-hidden /> Add note
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
