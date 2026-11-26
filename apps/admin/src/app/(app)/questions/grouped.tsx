import Link from 'next/link';
import { ChevronRight, FolderOpen, Link2, Sparkles, Unlink } from 'lucide-react';
import type { SegmentRuleInfo } from '@madp/contracts';
import type { Attribute, QuestionRow } from '@/lib/types';
import { Badge, PanelChip, fmt } from '@/components/ui';

const pretty = (s: string) => {
  const t = s.replace(/[-_]+/g, ' ').replace(/\d+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const TINTS = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#a855f7', '#eab308', '#14b8a6'];

/**
 * Questions grouped the way people think about them: segment, then profile, then each question with the shared
 * attribute it feeds. A question asked in several segments or profiles shows under each of them.
 */
export function GroupedQuestions({
  items,
  rules,
  segmentLabel,
  attributes,
}: {
  items: QuestionRow[];
  rules: SegmentRuleInfo[];
  segmentLabel: Record<string, string>;
  attributes: Attribute[];
}) {
  const attrLabel = new Map(attributes.map((a) => [a.key, a.label]));
  const ruleMap = new Map<string, string[]>();
  for (const r of rules.filter((x) => x.status === 'active')) {
    const k = `${r.panel}|${r.sourceValue.toLowerCase()}`;
    ruleMap.set(k, [...(ruleMap.get(k) ?? []), r.segment]);
  }
  const tree = new Map<string, Map<string, QuestionRow[]>>();
  for (const q of items) {
    const segs = [
      ...new Set(q.sourceCategories.flatMap((c) => ruleMap.get(`${q.panel}|${c.toLowerCase()}`) ?? [])),
    ];
    const profiles = q.questionnaires.length ? [...new Set(q.questionnaires)] : [''];
    for (const s of segs.length ? segs : ['']) {
      const byProfile = tree.get(s) ?? new Map<string, QuestionRow[]>();
      for (const p of profiles) byProfile.set(p, [...(byProfile.get(p) ?? []), q]);
      tree.set(s, byProfile);
    }
  }
  const segments = [...tree.entries()].sort(
    ([a], [b]) => (a === '' ? 1 : b === '' ? -1 : (segmentLabel[a] ?? a).localeCompare(segmentLabel[b] ?? b)),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2/60 px-4 py-2.5 text-[12.5px] text-fg-2">
        <span className="font-semibold text-fg">How to read this:</span>
        Segment → Profile → Question →
        <span className="inline-flex items-center gap-1 rounded-full bg-[#10b981]/12 px-2 py-0.5 font-semibold text-[#047857] dark:text-[#34d399]">
          <Link2 className="size-3" aria-hidden /> linked attribute
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#a855f7]/12 px-2 py-0.5 font-semibold text-[#7c3aed]">
          <Sparkles className="size-3" aria-hidden /> suggested, not approved yet
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-semibold text-fg-3">
          <Unlink className="size-3" aria-hidden /> not linked
        </span>
      </div>
      {segments.map(([seg, byProfile], si) => {
        const tint = TINTS[si % TINTS.length]!;
        const profiles = [...byProfile.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
        const total = new Set(profiles.flatMap(([, qs]) => qs.map((q) => `${q.panel}|${q.sourceQuestionId}`))).size;
        return (
          <details key={seg || 'none'} className="group/seg rise overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-soft" open={si === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
              <span className="grid size-10 place-items-center rounded-xl text-white" style={{ backgroundImage: `linear-gradient(135deg, ${tint}aa, ${tint})` }}>
                <FolderOpen className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-fg">{seg ? (segmentLabel[seg] ?? seg) : 'Not in a segment yet'}</p>
                <p className="text-[12px] text-fg-3">
                  {fmt(total)} questions in {fmt(profiles.length)} profiles
                </p>
              </div>
              <ChevronRight className="size-5 text-fg-3 transition group-open/seg:rotate-90" aria-hidden />
            </summary>
            <div className="space-y-2 border-t border-border bg-surface-2/30 p-3">
              {profiles.map(([profile, qs]) => {
                const linked = qs.filter((q) => q.mapping?.status === 'approved').length;
                return (
                  <details key={profile || 'none'} className="group/pro rounded-xl border border-border bg-surface">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
                      <ChevronRight className="size-4 text-fg-3 transition group-open/pro:rotate-90" aria-hidden />
                      <span className="text-[14px] font-semibold text-fg">{profile ? pretty(profile) : 'Not in a profile'}</span>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${tint}1a`, color: tint }}>
                        {fmt(qs.length)} questions
                      </span>
                      <span className="ml-auto text-[12px] text-fg-3">
                        {fmt(linked)} of {fmt(qs.length)} linked to an attribute
                      </span>
                    </summary>
                    <ul className="divide-y divide-border border-t border-border">
                      {qs.map((q) => (
                        <li key={`${q.panel}-${q.sourceQuestionId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                          <div className="min-w-0 flex-1">
                            <p className="text-fg">{q.label}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
                              <PanelChip panel={q.panel} />
                              <span className="font-mono">{q.sourceQuestionId}</span>
                              <span>{q.optionCount} options</span>
                              {q.parent ? <span>shown after {q.parent}</span> : null}
                              {q.sensitivity === 'special_category' ? <Badge tone="danger">sensitive</Badge> : null}
                            </p>
                          </div>
                          <AttributeChip q={q} label={attrLabel} />
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function AttributeChip({ q, label }: { q: QuestionRow; label: Map<string, string> }) {
  const m = q.mapping;
  if (m?.status === 'approved' && m.attributeKey)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#10b981]/12 px-2.5 py-1 text-[12px] font-semibold text-[#047857] dark:text-[#34d399]">
        <Link2 className="size-3.5" aria-hidden /> {label.get(m.attributeKey) ?? m.attributeKey}
      </span>
    );
  if (m?.suggestedAttributeKey)
    return (
      <Link
        href={`/mappings?panel=${q.panel}`}
        className="inline-flex items-center gap-1 rounded-full bg-[#a855f7]/12 px-2.5 py-1 text-[12px] font-semibold text-[#7c3aed] hover:underline"
        title="Suggested. Approve it in the Mapping workbench."
      >
        <Sparkles className="size-3.5" aria-hidden /> {label.get(m.suggestedAttributeKey) ?? m.suggestedAttributeKey}
      </Link>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-fg-3">
      <Unlink className="size-3.5" aria-hidden /> not linked
    </span>
  );
}

/**
 * Each shared attribute with the question that feeds it in every panel, side by side, so the same profile
 * attribute can be compared across T2O, MFR and MHO. Grouped by the attribute's segment.
 */
export function AttributeMatrix({
  items,
  attributes,
  panels,
  segmentLabel,
}: {
  items: QuestionRow[];
  attributes: Attribute[];
  panels: { code: string; name: string }[];
  segmentLabel: Record<string, string>;
}) {
  const byAttr = new Map<string, { approved: QuestionRow[]; suggested: QuestionRow[] }>();
  for (const q of items) {
    const m = q.mapping;
    const key = m?.status === 'approved' ? m.attributeKey : m?.suggestedAttributeKey;
    if (!key) continue;
    const e = byAttr.get(key) ?? { approved: [], suggested: [] };
    (m?.status === 'approved' ? e.approved : e.suggested).push(q);
    byAttr.set(key, e);
  }
  const groups = new Map<string, Attribute[]>();
  for (const a of attributes) groups.set(a.category ?? '', [...(groups.get(a.category ?? '') ?? []), a]);
  const unlinked = panels.map((p) => items.filter((q) => q.panel === p.code && !q.mapping?.attributeKey && !q.mapping?.suggestedAttributeKey).length);
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([cat, attrs], gi) => (
        <section key={cat || 'all'} className="rise overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-soft">
          <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
            <span className="size-3 rounded-full" style={{ background: TINTS[gi % TINTS.length] }} aria-hidden />
            <h2 className="text-[15px] font-bold text-fg">{cat ? (segmentLabel[cat] ?? cat) : 'Every segment'}</h2>
            <span className="text-[12px] text-fg-3">{fmt(attrs.length)} attributes</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-[11px] uppercase tracking-wider text-fg-3">
                  <th className="px-5 py-3 font-semibold">Attribute</th>
                  {panels.map((p) => (
                    <th key={p.code} className="px-5 py-3 font-semibold">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {attrs.map((a) => {
                  const e = byAttr.get(a.key);
                  return (
                    <tr key={a.key} className="align-top transition-colors hover:bg-accent-soft/40">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-fg">{a.label}</p>
                        <p className="font-mono text-[11px] text-fg-3">{a.key}</p>
                      </td>
                      {panels.map((p) => {
                        const ap = e?.approved.filter((q) => q.panel === p.code) ?? [];
                        const sg = e?.suggested.filter((q) => q.panel === p.code) ?? [];
                        return (
                          <td key={p.code} className="px-5 py-3">
                            {ap.length + sg.length === 0 ? (
                              <span className="text-[12px] text-fg-3">—</span>
                            ) : (
                              <ul className="space-y-1.5">
                                {ap.map((q) => (
                                  <li key={q.sourceQuestionId} className="flex gap-1.5">
                                    <Link2 className="mt-0.5 size-3.5 shrink-0 text-[#10b981]" aria-label="linked" />
                                    <span>{q.label}</span>
                                  </li>
                                ))}
                                {sg.map((q) => (
                                  <li key={q.sourceQuestionId} className="flex gap-1.5 text-fg-2">
                                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[#a855f7]" aria-label="suggested" />
                                    <Link href={`/mappings?panel=${q.panel}`} className="hover:underline">
                                      {q.label}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="rounded-xl bg-surface-2/60 px-4 py-3 text-[13px] text-fg-2">
        <span className="font-semibold text-fg">Not linked to any attribute yet:</span>{' '}
        {panels.map((p, i) => `${p.name} ${fmt(unlinked[i])}`).join(' · ')}. Link them in the{' '}
        <Link href="/mappings" className="font-semibold text-accent hover:underline">
          Mapping workbench
        </Link>
        .
      </p>
    </div>
  );
}
