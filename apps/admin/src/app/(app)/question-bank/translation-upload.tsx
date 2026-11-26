'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TEEN_BLOCKED_WORDS, type ParsedTable } from '@madp/contracts';
import { translationSaveAction } from '@/app/panel-actions';
import { mapHeader, UploadButton } from '@/components/files';
import { Badge, btn, fmt } from '@/components/ui';

interface Planned {
  question: string;
  label?: string;
  description?: string;
  options: { value: string; label: string }[];
  teen: boolean;
  blocked: string | null;
}
type Outcome = { question: string; ok: boolean; message: string };

const COLS = {
  question: ['key', 'question key', 'name'],
  part: ['type', 'what'],
  value: ['option value', 'option'],
  translation: ['translated', 'new wording', 'text'],
  teens: ['teen', 'teens see it', 'shown to teens'],
};

/** Reads the translation sheet into one change per question. Blank translations are skipped, never cleared. */
function plan(t: ParsedTable): { items: Planned[]; problems: string[]; skipped: number } {
  const rows = t.sheets[0]?.rows ?? [];
  const [head = [], ...body] = rows;
  const { index, missing } = mapHeader(head, COLS);
  const need = ['question', 'translation'].filter((k) => missing.includes(k));
  if (need.length)
    return {
      items: [],
      problems: [
        `The first sheet needs the columns: ${need.join(', ')}. Download the sheet above to get the right layout.`,
      ],
      skipped: 0,
    };
  const by = new Map<string, Planned>();
  const problems: string[] = [];
  let skipped = 0;
  body.forEach((r, i) => {
    const cell = (k: keyof typeof COLS) => (index[k] === undefined ? '' : (r[index[k]!] ?? '').trim());
    const q = cell('question');
    const text = cell('translation');
    if (!q) return;
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(q))
      return void problems.push(`Row ${i + 2}: "${q.slice(0, 40)}" is not a question key.`);
    if (!text) return void skipped++;
    const part = (cell('part') || (cell('value') ? 'option' : 'wording')).toLowerCase();
    const p = by.get(q) ?? { question: q, options: [], teen: false, blocked: null };
    p.teen ||= /^(yes|y|true|1)$/i.test(cell('teens'));
    if (part.startsWith('option')) {
      const v = cell('value');
      if (!v) return void problems.push(`Row ${i + 2}: an option row needs its option value.`);
      if (text.length > 500)
        return void problems.push(`Row ${i + 2}: option labels are at most 500 characters.`);
      p.options.push({ value: v, label: text });
    } else if (part.startsWith('desc')) p.description = text.slice(0, 2000);
    else {
      if (text.length > 500)
        return void problems.push(`Row ${i + 2}: the wording is at most 500 characters.`);
      p.label = text;
    }
    by.set(q, p);
  });
  const items = [...by.values()].map((p) => {
    const words =
      [p.label, p.description, ...p.options.map((o) => o.label)].join(' ').match(TEEN_BLOCKED_WORDS)?.[0] ??
      null;
    return { ...p, blocked: p.teen ? words : null };
  });
  return { items, problems, skipped };
}

/**
 * Upload a filled translation sheet (Excel or CSV) for one language. Step 1 is a preview that writes nothing; step 2
 * saves question by question through the same audited route as the translation editor. The panel still refuses the
 * teen guardrail words on questions teens can see, so those are flagged before saving.
 */
export function TranslationUpload({ lang }: { lang: string }) {
  const [file, setFile] = useState<string | null>(null);
  const [p, setP] = useState<ReturnType<typeof plan> | null>(null);
  const [done, setDone] = useState<Outcome[] | null>(null);
  const [pending, start] = useTransition();
  const ready = p ? p.items.filter((i) => !i.blocked) : [];
  const apply = () =>
    start(async () => {
      const out: Outcome[] = [];
      for (const i of ready) {
        const r = await translationSaveAction(i.question, {
          lang,
          ...(i.label ? { label: i.label } : {}),
          ...(i.description ? { description: i.description } : {}),
          ...(i.options.length ? { options: i.options } : {}),
        });
        out.push({
          question: i.question,
          ok: r.ok,
          message: r.ok ? `saved${r.data.optionsSet ? `, ${r.data.optionsSet} option labels` : ''}` : r.error,
        });
      }
      setDone(out);
      const bad = out.filter((o) => !o.ok).length;
      if (bad) toast.error(`${out.length - bad} saved, ${bad} refused. See the list.`);
      else toast.success(`Saved ${out.length} questions in ${lang}`);
    });
  return (
    <div className="grid gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <UploadButton
          kind="table"
          label={`Upload ${lang} translations`}
          title="Upload translations"
          help={{
            why: 'Translate many questions at once in Excel instead of one by one.',
            where: `Use the sheet from "Download sheet". Fill the Translation column in ${lang}. Blank cells are skipped, so nothing is ever wiped.`,
            how: [
              'Download the sheet, fill the Translation column, save it as Excel or CSV.',
              'Upload it: you see a preview first and nothing is saved yet.',
              'Press Save. Each question is saved and written to the Audit log. Teen questions with blocked words are left out.',
            ],
          }}
          onParsed={(t, name) => {
            setFile(name);
            setDone(null);
            setP(plan(t));
          }}
        />
        {file ? <span className="text-[12px] text-fg-3">{file}</span> : null}
      </div>
      {p ? (
        <div className="rise grid gap-2 rounded-xl border border-border bg-surface-2/50 p-3 text-[13px]">
          <p>
            <strong>Preview, nothing saved yet:</strong> {fmt(p.items.length)} questions to change in{' '}
            <strong>{lang}</strong>
            {p.skipped ? `, ${fmt(p.skipped)} blank rows skipped` : ''}.
          </p>
          {p.problems.length ? (
            <ul className="list-disc pl-5 text-danger">
              {p.problems.slice(0, 8).map((x) => (
                <li key={x}>{x}</li>
              ))}
              {p.problems.length > 8 ? <li>and {p.problems.length - 8} more</li> : null}
            </ul>
          ) : null}
          {p.items.length ? (
            <div className="max-h-72 overflow-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wider text-fg-3">
                  <tr>
                    <th className="px-3 py-1.5">Question</th>
                    <th className="px-3 py-1.5">Wording</th>
                    <th className="px-3 py-1.5">Option labels</th>
                    <th className="px-3 py-1.5">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {p.items.map((i) => {
                    const d = done?.find((o) => o.question === i.question);
                    return (
                      <tr key={i.question}>
                        <td className="px-3 py-1.5 font-mono">{i.question}</td>
                        <td className="max-w-xs truncate px-3 py-1.5">{i.label ?? '—'}</td>
                        <td className="px-3 py-1.5">{i.options.length || '—'}</td>
                        <td className="px-3 py-1.5">
                          {d ? (
                            <Badge tone={d.ok ? 'teal' : 'danger'}>{d.message}</Badge>
                          ) : i.blocked ? (
                            <Badge tone="danger">teens see it: “{i.blocked}” is blocked</Badge>
                          ) : (
                            <Badge tone="neutral">ready</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btn.primary}
              disabled={pending || !ready.length || done !== null}
              onClick={apply}
            >
              {pending ? 'Saving…' : `Save ${fmt(ready.length)} questions`}
            </button>
            <button
              type="button"
              className={btn.ghost}
              onClick={() => (setP(null), setFile(null), setDone(null))}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
