'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { nativeType, QUESTION_TYPES } from '@madp/contracts';
import { api, ApiError } from '@/lib/api';
import { attempt } from '@/lib/attempt';
import type { QuestionData } from './(app)/question-bank/[name]/question-editor';

/**
 * The question registry's editor works on several panels at once. Each write goes to one panel through the existing
 * question bank routes (POST/PUT /panel/questions, PUT .../options), with that panel picked by the x-madp-brand
 * header, so the API checks qb.edit on every panel and audits each write on its own.
 */
const KEY = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const PANEL = /^[a-z][a-z0-9_]{1,15}$/;
const on = (panel: string) => ({ headers: { 'x-madp-brand': panel } });
const enc = encodeURIComponent;

export type PanelCopy =
  | { panel: string; state: 'found'; question: QuestionData }
  | { panel: string; state: 'absent' }
  | { panel: string; state: 'error'; error: string };

/** The question with this key on each panel (absent where the panel has no such key). */
export async function loadCopies(name: string, panels: string[]): Promise<PanelCopy[]> {
  if (!KEY.test(name)) return [];
  return Promise.all(
    panels.filter((p) => PANEL.test(p)).map(async (panel): Promise<PanelCopy> => {
      try {
        return { panel, state: 'found', question: await api<QuestionData>(`/panel/questions/${enc(name)}`, on(panel)) };
      } catch (e) {
        unstable_rethrow(e);
        if (e instanceof ApiError && e.status === 404) return { panel, state: 'absent' };
        if (e instanceof ApiError && (e.status === 502 || e.status === 503))
          return { panel, state: 'error', error: 'not connected yet (add it on Panel connections)' };
        if (e instanceof ApiError && e.status === 403) return { panel, state: 'error', error: 'you have no question bank access on this panel' };
        return { panel, state: 'error', error: e instanceof ApiError ? e.message : 'could not be read' };
      }
    }),
  );
}

/** The question a dependency points at, so its answers can be picked as conditions. */
export async function loadParent(panel: string, name: string) {
  return attempt(async () => {
    if (!PANEL.test(panel) || !KEY.test(name.trim().toLowerCase())) throw new ApiError(400, 'Type a question key');
    const q = await api<QuestionData>(`/panel/questions/${enc(name.trim().toLowerCase())}`, on(panel));
    return { name: q.name, label: q.label, type: q.type, options: q.options.map((o) => ({ value: o.value, label: o.label })) };
  });
}

/** Find questions on a panel by key or wording, for the "depends on" picker. */
export async function searchQuestions(panel: string, q: string) {
  return attempt(async () => {
    if (!PANEL.test(panel)) throw new ApiError(400, 'Pick a panel');
    const r = await api<{ items: { name: string; label: string; type: string }[] }>(
      `/panel/questions?${new URLSearchParams({ q: q.slice(0, 100) })}`,
      on(panel),
    );
    return r.items.slice(0, 20).map(({ name, label, type }) => ({ name, label, type }));
  });
}

export interface SaveInput {
  name: string;
  typeKey: string;
  fields: {
    label: string;
    description: string;
    adminLabel: string;
    parent: string;
    topic: string;
    answeredBy: '' | 'teen' | 'parent' | 'both';
    isRequired: boolean;
    isEditable: boolean;
    hasOthers: boolean;
    hasNone: boolean;
    hasSkip: boolean;
    isMoney: boolean;
    size: string;
  };
  /** Per panel: create it there or update it, with the panel's own category words. */
  targets: { panel: string; create: boolean; category: string[] }[];
  options: { value: string; label: string; isExclusive?: boolean; parentValue?: string[]; countries?: string[]; describeLabel?: string }[] | null;
  reason: string;
}
export type SaveOutcome = { panel: string; ok: boolean; message: string };

export async function saveAcrossPanels(input: SaveInput): Promise<SaveOutcome[]> {
  const name = input.name.trim().toLowerCase();
  if (!KEY.test(name)) return [{ panel: '', ok: false, message: 'The key must be lower case letters, numbers, dots, dashes or underscores' }];
  const info = QUESTION_TYPES.find((t) => t.key === input.typeKey);
  if (!info) return [{ panel: '', ok: false, message: 'Pick a question type' }];
  if (!input.targets.length) return [{ panel: '', ok: false, message: 'Pick at least one panel' }];
  const f = input.fields;
  const out: SaveOutcome[] = [];
  for (const t of input.targets) {
    if (!PANEL.test(t.panel)) continue;
    if (!t.category.length) {
      out.push({ panel: t.panel, ok: false, message: 'no segment on this panel, so nothing was saved' });
      continue;
    }
    const { type, known } = nativeType(info.key, t.panel);
    const body: Record<string, unknown> = {
      label: f.label.trim(),
      type,
      category: t.category,
      parent: f.parent.trim().toLowerCase(),
      description: f.description,
      adminLabel: f.adminLabel,
      size: f.size,
      isRequired: f.isRequired,
      isEditable: f.isEditable,
      isMoney: info.settings.includes('isMoney') && f.isMoney,
      hasOthers: info.choice && f.hasOthers,
      hasNone: info.choice && f.hasNone,
      hasSkip: info.choice && f.hasSkip,
      topic: f.topic || null,
      ...(f.answeredBy ? { answeredBy: f.answeredBy } : {}),
      ...(input.reason.trim() ? { reason: input.reason.trim() } : {}),
    };
    try {
      if (t.create) await api(`/panel/questions`, { method: 'POST', json: { name, ...body }, ...on(t.panel) });
      else await api(`/panel/questions/${enc(name)}`, { method: 'PUT', json: body, ...on(t.panel) });
      let extra = '';
      if (info.choice && input.options) {
        const r = await api<{ added: number; retired: number }>(`/panel/questions/${enc(name)}/options`, {
          method: 'PUT',
          json: { options: input.options, ...(input.reason.trim() ? { reason: input.reason.trim() } : {}) },
          ...on(t.panel),
        });
        extra = `, answers: ${r.added} added, ${r.retired} retired`;
      }
      out.push({
        panel: t.panel,
        ok: true,
        message: `${t.create ? 'created' : 'saved'}${extra}${known ? '' : ` (first “${type}” question on this panel: check the member app shows it)`}`,
      });
    } catch (e) {
      unstable_rethrow(e);
      out.push({ panel: t.panel, ok: false, message: e instanceof ApiError ? e.message : 'something went wrong' });
    }
  }
  revalidatePath('/questions');
  revalidatePath(`/question-bank/${name}`);
  return out;
}

/** Link the registry copy of a question to a shared attribute (the same human decision as the Mapping workbench). */
export async function linkAttribute(mappingId: string, attributeKey: string) {
  return attempt(async () => {
    await api(`/mappings/${enc(mappingId)}/decision`, { method: 'POST', json: { decision: 'approve', attributeKey } });
    revalidatePath('/questions');
    revalidatePath('/mappings');
    return true;
  });
}
