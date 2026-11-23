import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { AuditRow } from '@/lib/types';
import { Badge, Card, PageHeader, Table, btn, fmtDate } from '@/components/ui';

export const metadata: Metadata = { title: 'Security audit' };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const data = await api<{ items: AuditRow[]; nextBefore: number | null }>(
    `/audit${before ? `?before=${Number(before)}` : ''}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Security audit"
        description="Append-only record of sign-ins, denied access, profile views, imports and mapping decisions. The database rejects edits and deletions of these rows."
      />
      <Card>
        <Table head={['When', 'Action', 'Outcome', 'Actor', 'Target', 'Details']}>
          {data.items.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="px-5 py-2.5 whitespace-nowrap">{fmtDate(e.at)}</td>
              <td className="px-5 py-2.5 font-mono text-xs">{e.action}</td>
              <td className="px-5 py-2.5">
                <Badge tone={e.outcome === 'success' ? 'teal' : 'danger'}>{e.outcome}</Badge>
              </td>
              <td className="px-5 py-2.5 font-mono text-xs">
                {e.actorType}
                {e.actorId ? ` · ${e.actorId.slice(0, 8)}` : ''}
              </td>
              <td className="px-5 py-2.5 font-mono text-xs">
                {e.targetType ? `${e.targetType} · ${String(e.targetId ?? '').slice(0, 24)}` : '—'}
              </td>
              <td className="max-w-sm px-5 py-2.5 font-mono text-[11px] text-fg-3">
                {JSON.stringify(e.metadata)}
              </td>
            </tr>
          ))}
        </Table>
        {data.nextBefore ? (
          <div className="border-t border-border px-5 py-3 text-right">
            <Link className={btn.secondary} href={`/audit?before=${data.nextBefore}`}>
              Older
            </Link>
          </div>
        ) : null}
      </Card>
    </>
  );
}
