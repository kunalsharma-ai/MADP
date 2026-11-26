'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlignLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  GitBranch,
  Hash,
  Layers,
  Link2,
  ListChecks,
  ListFilter,
  Mail,
  MapPin,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Type,
  Upload,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  QUESTION_SETTINGS,
  QUESTION_TYPE_GROUPS,
  QUESTION_TYPES,
  categoriesFor,
  nativeType,
  segmentsFor,
  typeInfo,
  type AudienceSegmentInfo,
  type SegmentRuleInfo,
} from '@madp/contracts';
import { cn } from '@/lib/cn';
import { PANEL_TONES } from '@/lib/panel-tones';
import type { Attribute } from '@/lib/types';
import {
  linkAttribute,
  loadParent,
  saveAcrossPanels,
  searchQuestions,
  type PanelCopy,
  type SaveInput,
  type SaveOutcome,
} from '@/app/registry-question-actions';
import { Badge, btn, input } from '@/components/ui';

const ICONS: Record<string, LucideIcon> = {
  radio: CircleDot,
  checkbox: ListChecks,
  select: ChevronDown,
  multiselect: ListFilter,
  text: Type,
  textarea: AlignLeft,
  email: Mail,
  phone: Phone,
  zipcode: MapPin,
  number: Hash,
  date: Calendar,
  document: Upload,
};
const GROUP_TINT: Record<string, string> = {
  choice: '#6366f1',
  text: '#ec4899',
  contact: '#0ea5e9',
  number_date: '#f97316',
  upload: '#10b981',
};
const TOPICS = ['tobacco', 'nicotine', 'alcohol', 'health', 'cosmetic', 'vehicle'];
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'answer';
const words = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

type Opt = NonNullable<SaveInput['options']>[number] & { existing?: boolean };
type ParentQ = { name: string; label: string; type: string; options: { value: string; label: string }[] };
interface PanelLite {
  code: string;
  name: string;
  shortName: string;
  sensitive: boolean;
}

function Section({ n, title, hint, tint, icon: Icon, children }: { n: number; title: string; hint: string; tint: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rise overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-soft">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="grid size-9 place-items-center rounded-xl text-white shadow-soft" style={{ backgroundImage: `linear-gradient(135deg, ${tint}99, ${tint})` }}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div>
          <h2 className="text-[15px] font-bold text-fg">
            <span className="mr-1.5 text-fg-3">{n}.</span>
            {title}
          </h2>
          <p className="text-[12px] text-fg-3">{hint}</p>
        </div>
      </header>
      <div className="px-5 py-4 text-[13px]">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 transition hover:border-accent/40">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-surface-2 ring-1 ring-border transition peer-checked:bg-gradient-to-r peer-checked:from-[#4f5bd5] peer-checked:to-[#8b5cf6] peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
      <span>
        <span className="block font-semibold text-fg">{label}</span>
        <span className="block text-[12px] text-fg-3">{hint}</span>
      </span>
    </label>
  );
}

export function RegistryEditor({
  name,
  opened,
  panels,
  segments,
  rules,
  attributes,
  copies,
  mappings,
}: {
  name: string | null;
  opened: string | null;
  panels: PanelLite[];
  segments: AudienceSegmentInfo[];
  rules: SegmentRuleInfo[];
  attributes: Attribute[];
  copies: PanelCopy[];
  mappings: Record<string, { id: string; status: string; attributeKey: string | null; suggestedAttributeKey: string | null }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isNew = !name;
  const copyOf = (p: string) => copies.find((c) => c.panel === p);
  const found = copies.filter((c): c is Extract<PanelCopy, { state: 'found' }> => c.state === 'found');
  const base = (opened ? found.find((c) => c.panel === opened) : undefined) ?? found[0];
  const q = base?.question;

  const [key, setKey] = useState(name ?? '');
  const initialType = typeInfo(q?.type);
  const [typeKey, setTypeKey] = useState(initialType?.key ?? 'radio');
  const info = QUESTION_TYPES.find((t) => t.key === typeKey)!;
  const [f, setF] = useState<SaveInput['fields']>({
    label: q?.label ?? '',
    description: q?.description ?? '',
    adminLabel: q?.adminLabel ?? '',
    parent: q?.parent ?? '',
    topic: q?.topic ?? '',
    answeredBy: q?.answeredBy ?? '',
    isRequired: q?.isRequired ?? DEFAULT_SETTINGS.isRequired,
    isEditable: q?.isEditable ?? DEFAULT_SETTINGS.isEditable,
    hasOthers: q?.hasOthers ?? DEFAULT_SETTINGS.hasOthers,
    hasNone: q?.hasNone ?? DEFAULT_SETTINGS.hasNone,
    hasSkip: q?.hasSkip ?? DEFAULT_SETTINGS.hasSkip,
    isMoney: q?.isMoney ?? DEFAULT_SETTINGS.isMoney,
    size: (q as { size?: string } | undefined)?.size ?? DEFAULT_SETTINGS.size,
  });
  const set = <K extends keyof SaveInput['fields']>(k: K, v: SaveInput['fields'][K]) => setF((x) => ({ ...x, [k]: v }));

  // ---- where: panels, segments and each panel's own category words ------------------------------------------------
  const usable = panels.filter((p) => copyOf(p.code)?.state !== 'error');
  const [picked, setPicked] = useState<Set<string>>(
    new Set(isNew ? (opened ? [opened] : usable.map((p) => p.code)) : base ? [base.panel] : []),
  );
  const [segKeys, setSegKeys] = useState<Set<string>>(
    // The segments of the copy being edited; other panels keep their own category words until they are ticked and changed.
    () => new Set(base ? segmentsFor(base.panel, base.question.category, segments, rules) : []),
  );
  const [cats, setCats] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      panels.map((p) => {
        const c = copyOf(p.code);
        if (c?.state === 'found') return [p.code, c.question.category];
        return [p.code, categoriesFor(p.code, [...segKeys], segments, rules).categories];
      }),
    ),
  );
  const [wordsOpen, setWordsOpen] = useState(false);
  const toggleSegment = (k: string) => {
    const next = new Set(segKeys);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSegKeys(next);
    setCats((prev) =>
      Object.fromEntries(
        panels.map((p) => {
          if (!picked.has(p.code)) return [p.code, prev[p.code] ?? []];
          const owned = new Set(categoriesFor(p.code, segments.map((s) => s.key), segments, rules).categories);
          const keep = (prev[p.code] ?? []).filter((c) => !owned.has(c));
          return [p.code, [...new Set([...keep, ...categoriesFor(p.code, [...next], segments, rules).categories])]];
        }),
      ),
    );
  };
  const teen = segments.some((s) => s.minors && segKeys.has(s.key));
  const sensitivePicked = panels.filter((p) => p.sensitive && picked.has(p.code));

  // ---- answers ---------------------------------------------------------------------------------------------------
  const [opts, setOpts] = useState<Opt[]>(() =>
    (q?.options ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      isExclusive: o.isExclusive ?? false,
      parentValue: o.parentValue ?? [],
      ...(o.countries?.length ? { countries: o.countries } : {}),
      existing: true,
    })),
  );
  const [newLabel, setNewLabel] = useState('');
  const addOption = (label: string) => {
    const l = label.trim();
    if (!l) return;
    let v = slug(l);
    const taken = new Set(opts.map((o) => o.value));
    for (let i = 2; taken.has(v); i++) v = `${slug(l)}-${i}`;
    setOpts((o) => [...o, { value: v, label: l, isExclusive: false, parentValue: [] }]);
    setNewLabel('');
  };
  const setOpt = (i: number, patch: Partial<Opt>) => setOpts((o) => o.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // ---- dependency ------------------------------------------------------------------------------------------------
  const dependencyPanel = [...picked][0] ?? base?.panel ?? panels[0]?.code ?? '';
  const [parentQ, setParentQ] = useState<ParentQ | null>(null);
  const [parentSearch, setParentSearch] = useState('');
  const [hits, setHits] = useState<{ name: string; label: string; type: string }[]>([]);
  const loadP = (n: string) =>
    start(async () => {
      if (!n) return setParentQ(null);
      const r = await loadParent(dependencyPanel, n);
      if (!r.ok) {
        setParentQ(null);
        return void toast.error(`${n}: ${r.error}`);
      }
      setParentQ(r.data);
    });
  // An existing dependency: load its parent once, so its answers show as conditions straight away.
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current || !f.parent) return;
    loadedOnce.current = true;
    loadP(f.parent);
  }, []);
  const parentIsChoice = !!parentQ && !!typeInfo(parentQ.type)?.choice;
  // The answers of the parent that every option shares, i.e. "show this question when the parent's answer is ...".
  const shared = useMemo(() => {
    const sets = new Set(opts.map((o) => JSON.stringify([...(o.parentValue ?? [])].sort())));
    return sets.size === 1 ? (opts[0]?.parentValue ?? []) : null;
  }, [opts]);
  const setShared = (vals: string[]) => setOpts((o) => o.map((x) => ({ ...x, parentValue: vals })));

  // ---- save ------------------------------------------------------------------------------------------------------
  const [reason, setReason] = useState('');
  const [results, setResults] = useState<SaveOutcome[]>([]);
  const targets = panels
    .filter((p) => picked.has(p.code))
    .map((p) => ({ panel: p.code, create: copyOf(p.code)?.state !== 'found', category: cats[p.code] ?? [] }));
  const problems: string[] = [];
  if (!KEY_RE.test(key)) problems.push('Give the question a key (lower case, no spaces)');
  if (!f.label.trim()) problems.push('Write the question wording');
  if (!targets.length) problems.push('Tick at least one panel');
  for (const t of targets) if (!t.category.length) problems.push(`Pick a segment that ${panelName(panels, t.panel)} has`);
  if (info.choice && opts.length < 2) problems.push('Add at least two answers');
  if (f.parent && f.parent === key) problems.push('A question can’t depend on itself');
  const save = () =>
    start(async () => {
      const r = await saveAcrossPanels({
        name: key,
        typeKey,
        fields: f,
        targets,
        options: info.choice ? opts.map(({ existing: _e, ...o }) => o) : null,
        reason,
      });
      setResults(r);
      const ok = r.filter((x) => x.ok).length;
      if (ok === r.length) toast.success(`Saved on ${ok} panel${ok === 1 ? '' : 's'}`);
      else toast.error(`${r.length - ok} of ${r.length} panels refused the change`);
      if (ok) {
        if (isNew) router.replace(`/questions/edit?${new URLSearchParams({ name: key, panel: r.find((x) => x.ok)!.panel })}`);
        else router.refresh();
      }
    });

  return (
    <div className="grid gap-4 pb-28">
      {/* 1. Where */}
      <Section n={1} title="Where it shows" hint="Tick the panels, then the segments. Each panel gets its own category words from the segment rules." tint="#6366f1" icon={Layers}>
        <div className="grid gap-3 sm:grid-cols-3">
          {panels.map((p) => {
            const c = copyOf(p.code);
            const [light, deep] = PANEL_TONES[p.code] ?? ['#a5b4fc', '#6366f1'];
            const on = picked.has(p.code);
            const disabled = c?.state === 'error';
            return (
              <label
                key={p.code}
                className={cn(
                  'relative flex cursor-pointer flex-col gap-1 rounded-2xl border-2 p-4 transition hover:-translate-y-0.5',
                  on ? 'border-transparent text-white shadow-soft' : 'border-border bg-surface',
                  disabled && 'cursor-not-allowed opacity-60 hover:translate-y-0',
                )}
                style={on ? { backgroundImage: `linear-gradient(135deg, ${light}, ${deep})` } : undefined}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={disabled}
                  onChange={(e) => {
                    const n = new Set(picked);
                    if (e.target.checked) {
                      n.add(p.code);
                      // A panel that doesn't ask it yet takes the segments picked so far.
                      if (c?.state !== 'found')
                        setCats((x) => ({ ...x, [p.code]: categoriesFor(p.code, [...segKeys], segments, rules).categories }));
                    } else n.delete(p.code);
                    setPicked(n);
                  }}
                />
                <span className="flex items-center gap-2 text-[15px] font-bold">
                  {on ? <CheckCircle2 className="size-5" aria-hidden /> : <span className="size-5 rounded-full border-2 border-border" aria-hidden />}
                  {p.name}
                </span>
                <span className={cn('text-[12px]', on ? 'text-white/90' : 'text-fg-3')}>
                  {c?.state === 'found'
                    ? 'Already asked here: saving updates it'
                    : c?.state === 'error'
                      ? `Can’t use: ${c.error}`
                      : 'Not asked here yet: saving adds it'}
                </span>
                {p.sensitive ? <span className={cn('text-[11px] font-semibold', on ? 'text-white' : 'text-[#be123c]')}>Health panel: answers are special category</span> : null}
              </label>
            );
          })}
        </div>
        <p className="mb-2 mt-4 font-semibold text-fg">Segments</p>
        <div className="flex flex-wrap gap-2">
          {segments.map((s) => {
            const on = segKeys.has(s.key);
            const where = panels.filter((p) => !categoriesFor(p.code, [s.key], segments, rules).missing.length).map((p) => p.shortName);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSegment(s.key)}
                aria-pressed={on}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[13px] font-semibold transition',
                  on ? 'border-transparent bg-gradient-to-r from-[#4f5bd5] to-[#8b5cf6] text-white shadow-soft' : 'border-border bg-surface text-fg-2 hover:border-accent/50',
                )}
                title={where.length ? `On ${where.join(', ')}` : 'No panel has a rule for this segment yet'}
              >
                {s.label}
                {s.minors ? ' (under 18)' : ''}
                <span className={cn('ml-1.5 text-[11px] font-normal', on ? 'text-white/80' : 'text-fg-3')}>{where.join(' · ') || 'no panel'}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 rounded-xl bg-surface-2/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-semibold text-fg">What each panel gets:</span>
            {panels
              .filter((p) => picked.has(p.code))
              .map((p) => (
                <span key={p.code} className="inline-flex items-center gap-1.5">
                  <span className="font-semibold">{p.shortName}</span>
                  {(cats[p.code] ?? []).length ? (
                    (cats[p.code] ?? []).map((c) => (
                      <Badge key={c} tone={c.includes('minor') ? 'accent' : 'neutral'}>
                        {c}
                      </Badge>
                    ))
                  ) : (
                    <Badge tone="warn">no segment here</Badge>
                  )}
                </span>
              ))}
            <button type="button" className={cn(btn.ghost, 'ml-auto')} onClick={() => setWordsOpen((x) => !x)}>
              {wordsOpen ? 'Hide' : 'Change'} panel words
            </button>
          </div>
          {wordsOpen ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {panels
                .filter((p) => picked.has(p.code))
                .map((p) => (
                  <label key={p.code}>
                    {p.shortName} categories (comma-separated)
                    <input
                      className={`${input} font-mono text-[12px]`}
                      value={(cats[p.code] ?? []).join(', ')}
                      onChange={(e) => setCats((x) => ({ ...x, [p.code]: words(e.target.value) }))}
                    />
                  </label>
                ))}
            </div>
          ) : null}
        </div>
        {sensitivePicked.length ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff1f2] px-4 py-2.5 text-[12.5px] text-[#9f1239] dark:bg-[#4c0519]/40 dark:text-[#fda4af]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Answers on {sensitivePicked.map((p) => p.name).join(', ')} are special category (health). They are only used with the member’s consent, and nothing about health is guessed from membership.
          </p>
        ) : null}
      </Section>

      {/* 2. Type */}
      <Section n={2} title="Kind of question" hint="Every kind the three panels use, grouped. Each one shows the answer it expects." tint="#ec4899" icon={ListChecks}>
        {q && !initialType ? (
          <p className="mb-3 rounded-xl bg-[#fffbeb] px-4 py-2 text-[12.5px] text-[#92400e]">
            This question is stored as “{q.type}”, which isn’t one of the known kinds. Pick the closest kind below before you save.
          </p>
        ) : null}
        <div className="grid gap-4">
          {QUESTION_TYPE_GROUPS.map((g) => (
            <div key={g.key}>
              <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: GROUP_TINT[g.key] }}>
                {g.label} <span className="font-normal normal-case tracking-normal text-fg-3">· {g.hint}</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {QUESTION_TYPES.filter((t) => t.group === g.key).map((t) => {
                  const Icon = ICONS[t.key] ?? Type;
                  const on = t.key === typeKey;
                  const tint = GROUP_TINT[g.key]!;
                  const fresh = panels.filter((p) => picked.has(p.code) && !nativeType(t.key, p.code).known).map((p) => p.shortName);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTypeKey(t.key)}
                      aria-pressed={on}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border-2 p-3 text-left transition hover:-translate-y-0.5',
                        on ? 'shadow-soft' : 'border-border bg-surface',
                      )}
                      style={on ? { borderColor: tint, background: `${tint}10` } : undefined}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg text-white" style={{ backgroundImage: `linear-gradient(135deg, ${tint}88, ${tint})` }}>
                        <Icon className="size-[18px]" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-fg">{t.label}</span>
                        <span className="block text-[12px] text-fg-3">{t.hint}</span>
                        {fresh.length ? <span className="mt-0.5 block text-[11px] text-[#b45309]">New on {fresh.join(', ')}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 3. Wording */}
      <Section n={3} title="Wording" hint="What the member reads. The key links answers, so it never changes once members have answered." tint="#f97316" icon={Type}>
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            Key {isNew ? '(lower case, never changes)' : ''}
            <input
              className={`${input} font-mono`}
              value={key}
              readOnly={!isNew}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="e.g. pet-ownership"
            />
          </label>
          <label>
            Admin label (only admins see it)
            <input className={input} value={f.adminLabel} onChange={(e) => set('adminLabel', e.target.value)} />
          </label>
          <label className="md:col-span-2">
            Question wording
            <textarea className={input} rows={2} value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Which pets do you have at home?" />
          </label>
          <label className="md:col-span-2">
            Help text under the question (optional)
            <textarea className={input} rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </label>
        </div>
      </Section>

      {/* 4. Answers */}
      {info.choice ? (
        <Section n={4} title="Answers" hint="The list the member picks from. A removed answer is retired, not deleted, so old answers keep their meaning." tint="#10b981" icon={ListChecks}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-fg-3">
                  <th className="py-2 pr-3 font-semibold">Answer</th>
                  <th className="py-2 pr-3 font-semibold">Stored as</th>
                  {info.multi ? <th className="py-2 pr-3 font-semibold">Clears the others</th> : null}
                  {f.parent && parentIsChoice ? <th className="py-2 pr-3 font-semibold">Only when {f.parent} is</th> : null}
                  <th className="py-2 pr-3 font-semibold">Only in countries</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {opts.map((o, i) => (
                  <tr key={`${o.value}-${i}`} className="align-top">
                    <td className="py-2 pr-3">
                      <input className={input} value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} aria-label="Answer" />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className={`${input} font-mono text-[12px]`}
                        value={o.value}
                        readOnly={o.existing}
                        title={o.existing ? 'Stored answers keep their value' : undefined}
                        onChange={(e) => setOpt(i, { value: e.target.value })}
                        aria-label="Stored value"
                      />
                    </td>
                    {info.multi ? (
                      <td className="py-2 pr-3">
                        <input type="checkbox" checked={!!o.isExclusive} onChange={(e) => setOpt(i, { isExclusive: e.target.checked })} aria-label="Exclusive" />
                      </td>
                    ) : null}
                    {f.parent && parentIsChoice ? (
                      <td className="py-2 pr-3">
                        <select
                          multiple
                          className={`${input} h-20 text-[12px]`}
                          value={o.parentValue ?? []}
                          onChange={(e) => setOpt(i, { parentValue: [...e.target.selectedOptions].map((x) => x.value) })}
                          aria-label="Shown for parent answers"
                        >
                          {parentQ!.options.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                    <td className="py-2 pr-3">
                      <input
                        className={`${input} font-mono text-[12px]`}
                        placeholder="all"
                        value={(o.countries ?? []).join(', ')}
                        onChange={(e) => setOpt(i, { countries: words(e.target.value).map((c) => c.toUpperCase()) })}
                        aria-label="Countries"
                      />
                    </td>
                    <td className="py-2">
                      <button type="button" className={btn.ghost} onClick={() => setOpts((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${o.label}`}>
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addOption(newLabel);
            }}
          >
            <input className={`${input} max-w-sm`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Type an answer and press Add" />
            <button className={btn.secondary}>
              <Plus className="size-4" aria-hidden /> Add
            </button>
          </form>
          <p className="mt-2 text-[12px] text-fg-3">Countries are two-letter codes such as IN, US. Leave empty to show the answer everywhere.</p>
        </Section>
      ) : null}

      {/* 5. Rules */}
      <Section n={info.choice ? 5 : 4} title="Rules and checks" hint="Whether the answer is required, and the other rules this kind of question supports." tint="#0ea5e9" icon={ShieldCheck}>
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-[#ecfeff] px-4 py-2.5 text-[12.5px] text-[#155e75] dark:bg-[#083344]/50 dark:text-[#67e8f9]">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>
            <b>Expected answer:</b> {info.expects}.
          </span>
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {info.settings
            .filter((s) => s !== 'size')
            .map((s) => (
              <Toggle key={s} checked={!!f[s]} onChange={(v) => set(s, v)} label={QUESTION_SETTINGS[s].label} hint={QUESTION_SETTINGS[s].hint} />
            ))}
          <label className="rounded-xl border border-border px-3 py-2.5">
            <span className="block font-semibold text-fg">{QUESTION_SETTINGS.size.label}</span>
            <span className="block text-[12px] text-fg-3">{QUESTION_SETTINGS.size.hint}</span>
            <select className={`${input} mt-1.5`} value={f.size} onChange={(e) => set('size', e.target.value)}>
              {[...new Set(['3', '4', '6', '8', '12', f.size])].map((s) => (
                <option key={s} value={s}>
                  {s === '12' ? '12 (full row)' : s === '6' ? '6 (half row)' : s}
                </option>
              ))}
            </select>
          </label>
        </div>
        {teen ? (
          <div className="mt-3 grid gap-3 rounded-xl bg-[#f5f3ff] p-3 md:grid-cols-2 dark:bg-[#2e1065]/40">
            <p className="text-[12.5px] text-[#5b21b6] md:col-span-2 dark:text-[#c4b5fd]">
              <b>Teens are picked.</b> The panel refuses tobacco, nicotine, alcohol, health, cosmetic and vehicle questions for teens, so set the subject honestly.
            </p>
            <label>
              Subject
              <select className={input} value={f.topic} onChange={(e) => set('topic', e.target.value)}>
                <option value="">None of these</option>
                {TOPICS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Answered by
              <select className={input} value={f.answeredBy} onChange={(e) => set('answeredBy', e.target.value as SaveInput['fields']['answeredBy'])}>
                <option value="">Not set</option>
                <option value="teen">The teen</option>
                <option value="parent">A parent</option>
                <option value="both">Either</option>
              </select>
            </label>
          </div>
        ) : null}
        <p className="mt-3 text-[12px] text-fg-3">
          Extra checks such as a minimum or maximum length, a number range or a custom pattern aren’t stored by the panels today.
        </p>
      </Section>

      {/* 6. Dependency */}
      <Section
        n={info.choice ? 6 : 5}
        title="Depends on another question"
        hint="Show this question only after the member answers an earlier one, and, for answer lists, only for some of its answers."
        tint="#a855f7"
        icon={GitBranch}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1">
            Shown after (question key)
            <input
              className={`${input} font-mono`}
              value={f.parent}
              onChange={(e) => {
                set('parent', e.target.value.trim().toLowerCase());
                setParentQ(null);
              }}
              placeholder="empty = always shown"
            />
          </label>
          <button type="button" className={btn.secondary} disabled={!f.parent || pending} onClick={() => loadP(f.parent)}>
            Load its answers
          </button>
          {f.parent ? (
            <button
              type="button"
              className={btn.ghost}
              onClick={() => {
                set('parent', '');
                setParentQ(null);
                setShared([]);
              }}
            >
              Remove the dependency
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className={`${input} max-w-xs`}
            value={parentSearch}
            onChange={(e) => setParentSearch(e.target.value)}
            placeholder={`Find a question on ${panelName(panels, dependencyPanel)}`}
          />
          <button
            type="button"
            className={btn.ghost}
            disabled={!parentSearch.trim() || pending}
            onClick={() =>
              start(async () => {
                const r = await searchQuestions(dependencyPanel, parentSearch);
                if (!r.ok) return void toast.error(r.error);
                setHits(r.data.filter((h) => h.name !== key));
              })
            }
          >
            Search
          </button>
          {hits.map((h) => (
            <button
              key={h.name}
              type="button"
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] hover:border-accent"
              onClick={() => {
                set('parent', h.name);
                setHits([]);
                loadP(h.name);
              }}
            >
              <span className="font-mono">{h.name}</span> <span className="text-fg-3">{h.label.slice(0, 50)}</span>
            </button>
          ))}
        </div>
        {f.parent && parentQ ? (
          <div className="mt-3 rounded-xl bg-[#faf5ff] p-3 dark:bg-[#3b0764]/30">
            <p className="text-[13px] text-fg">
              Shown after <b>{parentQ.label}</b> <span className="font-mono text-fg-3">({parentQ.name})</span> is answered.
            </p>
            {parentIsChoice && info.choice ? (
              <>
                <p className="mt-2 text-[12.5px] text-fg-2">
                  {shared ? 'Only when the answer is (none ticked = any answer):' : 'Each answer has its own condition (see the Answers table). Tick here to set one condition for all of them:'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {parentQ.options.map((p) => {
                    const on = (shared ?? []).includes(p.value);
                    return (
                      <button
                        key={p.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setShared(on ? (shared ?? []).filter((v) => v !== p.value) : [...(shared ?? []), p.value])}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[12px] font-semibold transition',
                          on ? 'border-transparent bg-[#a855f7] text-white' : 'border-border bg-surface text-fg-2',
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : parentIsChoice ? (
              <p className="mt-2 text-[12.5px] text-fg-3">
                A typed question can only wait for its parent to be answered: the panels keep answer conditions on answer lists.
              </p>
            ) : null}
          </div>
        ) : f.parent ? (
          <p className="mt-2 text-[12px] text-fg-3">Press “Load its answers” to check the question exists on {panelName(panels, dependencyPanel)} and pick conditions.</p>
        ) : null}
        <p className="mt-3 text-[12px] text-fg-3">
          The Question bank’s <Link className="text-accent hover:underline" href="/question-bank?tab=rules">Show-when rules</Link> tab lists any rule that points at a missing question or answer.
        </p>
      </Section>

      {/* 7. Attribute and profiles */}
      <Section
        n={info.choice ? 7 : 6}
        title="Attribute and profiles"
        hint="Link the question to a shared attribute so answers compare across panels, and place it on a profile page."
        tint="#eab308"
        icon={Link2}
      >
        {isNew ? (
          <p className="text-fg-2">
            A new question reaches the registry with the next sync. Then open it here again (or the{' '}
            <Link href="/mappings" className="text-accent hover:underline">Mapping workbench</Link>) to link it to an attribute.
          </p>
        ) : (
          <div className="grid gap-2">
            {panels
              .filter((p) => copyOf(p.code)?.state === 'found')
              .map((p) => (
                <AttributeLink key={p.code} panel={p} mapping={mappings[p.code]} attributes={attributes} />
              ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {found.flatMap((c) =>
            c.question.profiles.map((pr) => (
              <Badge key={`${c.panel}-${pr.slug}-${pr.category}`}>
                {panelName(panels, c.panel)}: {pr.slug} ({pr.category})
              </Badge>
            )),
          )}
          <Link href="/questionnaires" className={btn.ghost}>
            Place it on a profile page (Questionnaires, with a second admin’s review)
          </Link>
        </div>
      </Section>

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.3)] backdrop-blur sm:pl-72">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <input className={`${input} max-w-sm`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (kept in the audit log)" aria-label="Reason" />
          <button type="button" className={btn.primary} disabled={pending || problems.length > 0} onClick={save}>
            <Save className="size-4" aria-hidden />
            {isNew ? 'Add' : 'Save'} on {targets.length} panel{targets.length === 1 ? '' : 's'}
          </button>
          {problems.length ? <span className="text-[12px] text-[#b45309]">{problems[0]}</span> : null}
          {results.length ? (
            <ul className="flex w-full flex-wrap gap-x-4 gap-y-1 text-[12px]">
              {results.map((r) => (
                <li key={r.panel || 'all'} className={cn('inline-flex items-center gap-1', r.ok ? 'text-[#047857]' : 'text-[#b91c1c]')}>
                  {r.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
                  <b>{r.panel ? panelName(panels, r.panel) : 'Not saved'}</b> {r.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const panelName = (panels: PanelLite[], code: string) => panels.find((p) => p.code === code)?.shortName ?? code.toUpperCase();

function AttributeLink({
  panel,
  mapping,
  attributes,
}: {
  panel: PanelLite;
  mapping?: { id: string; status: string; attributeKey: string | null; suggestedAttributeKey: string | null };
  attributes: Attribute[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState(mapping?.attributeKey ?? mapping?.suggestedAttributeKey ?? '');
  const label = (k: string | null) => attributes.find((a) => a.key === k)?.label ?? k;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
      <span className="w-14 font-semibold">{panel.shortName}</span>
      {!mapping ? (
        <span className="text-fg-3">Not in the registry yet: it appears after the next sync.</span>
      ) : (
        <>
          {mapping.status === 'approved' ? (
            <Badge tone="teal">linked: {label(mapping.attributeKey)}</Badge>
          ) : mapping.suggestedAttributeKey ? (
            <Badge tone="accent">suggested: {label(mapping.suggestedAttributeKey)}</Badge>
          ) : (
            <Badge>not linked</Badge>
          )}
          <select className={`${input} max-w-xs`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Attribute for ${panel.shortName}`}>
            <option value="">Choose an attribute</option>
            {attributes.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn.secondary}
            disabled={!pick || pending || (mapping.status === 'approved' && pick === mapping.attributeKey)}
            onClick={() =>
              start(async () => {
                const r = await linkAttribute(mapping.id, pick);
                if (!r.ok) return void toast.error(r.error);
                toast.success(`${panel.shortName}: linked to ${label(pick)}`);
                router.refresh();
              })
            }
          >
            <Link2 className="size-4" aria-hidden /> Link
          </button>
        </>
      )}
    </div>
  );
}
