import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { AudienceSegmentInfo, DataMode, SegmentRuleInfo } from '@madp/contracts';
import { api } from '@/lib/api';
import { getPanels } from '@/lib/panels';
import type { Attribute, QuestionRow } from '@/lib/types';
import { loadCopies } from '@/app/registry-question-actions';
import { PageHeader, btn } from '@/components/ui';
import { RegistryEditor } from './editor';

export const metadata: Metadata = { title: 'Edit question' };

const KEY = /^[a-z0-9][a-z0-9_.-]{0,79}$/;

export default async function EditQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; panel?: string }>;
}) {
  const sp = await searchParams;
  const name = sp.name && KEY.test(sp.name) ? sp.name : null;
  // Inbox networks have no question bank of their own: only panels on the shared panel backend can take questions.
  const panels = (await getPanels()).filter((p) => p.sourceType === 'panel_api');
  const opened = panels.find((p) => p.code === sp.panel)?.code ?? null;
  const [seg, attrs, copies, registry] = await Promise.all([
    api<{ segments: AudienceSegmentInfo[]; rules: SegmentRuleInfo[] }>('/audience-segments').catch(() => ({ segments: [], rules: [] })),
    api<{ attributes: Attribute[] }>('/audience/attributes').catch(() => ({ attributes: [] })),
    name ? loadCopies(name, panels.map((p) => p.code)) : Promise.resolve([]),
    name
      ? api<{ dataMode: DataMode; items: QuestionRow[] }>(`/questions?${new URLSearchParams({ search: name })}`).catch(() => ({ items: [] as QuestionRow[] }))
      : Promise.resolve({ items: [] as QuestionRow[] }),
  ]);
  const mappings = Object.fromEntries(
    registry.items.filter((q) => q.sourceQuestionId === name && q.mapping).map((q) => [q.panel, q.mapping!]),
  );
  return (
    <>
      <PageHeader
        eyebrow="Data · Question registry"
        title={name ? `Edit “${name}”` : 'Add a new question'}
        description="Pick the panels and segments, the kind of question, its answers, its rules and what it depends on. Saving writes to each panel you ticked; every write is checked and kept in the audit log."
        actions={
          <Link href="/questions" className={btn.secondary}>
            <ArrowLeft className="size-4" aria-hidden /> Back to the registry
          </Link>
        }
      />
      <RegistryEditor
        name={name}
        opened={opened}
        panels={panels.map(({ code, name: n, shortName, sensitive }) => ({ code, name: n, shortName, sensitive }))}
        segments={seg.segments.filter((s) => s.status === 'active')}
        rules={seg.rules.filter((r) => r.status === 'active')}
        attributes={attrs.attributes}
        copies={copies}
        mappings={mappings}
      />
    </>
  );
}
