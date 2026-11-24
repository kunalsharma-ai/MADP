import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { Card, CardHeader, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Template preview' };

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await api<{ subject: string; html: string; text: string; brandWarning: string | null; problems: string[] }>(
    `/communications/template-versions/${encodeURIComponent(id)}/preview`,
  );
  return (
    <>
      <PageHeader eyebrow="Engagement studio" title={p.subject} description="Rendered with sample values only, never with a member's data." />
      {p.brandWarning ? <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">{p.brandWarning}</p> : null}
      {p.problems.length ? (
        <ul className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {p.problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="HTML" />
          {/* Sandboxed: no scripts, no same-origin access. */}
          <iframe title="HTML preview" sandbox="" srcDoc={p.html} className="h-[480px] w-full rounded-b-xl bg-white" />
        </Card>
        <Card>
          <CardHeader title="Plain text" />
          <pre className="whitespace-pre-wrap px-5 py-4 text-[13px]">{p.text}</pre>
        </Card>
      </div>
    </>
  );
}
