import type { Metadata } from 'next';
import Link from 'next/link';
import type { SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import type { AuditRow } from '@/lib/types';
import { Badge, Card, PageHeader, PanelChip, Table, btn, fmtDate, input } from '@/components/ui';
import { VerifyChain } from './verify-chain';

export const metadata: Metadata = { title: 'Security audit' };

const FILTERS = ['actorId', 'action', 'targetType', 'targetId', 'outcome', 'from', 'to'] as const;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of [...FILTERS, 'before'] as const) if (sp[k]) qs.set(k, String(sp[k]));
  const [data, me] = await Promise.all([
    api<{ items: AuditRow[]; nextBefore: number | null }>(`/audit?${qs}`),
    api<SessionUser>('/auth/me'),
  ]);
  // The chain check covers every brand's entries, so it needs audit.read on all of them.
  const canVerify = me.permissions.includes('audit.read');
  const exportQs = new URLSearchParams(qs);
  exportQs.delete('before');
  const older = new URLSearchParams(qs);
  if (data.nextBefore) older.set('before', String(data.nextBefore));
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Security audit"
        description="Every admin write and sensitive read, for the brand picked at the top. Entries are append-only and hash-chained: each stores the hash of the one before, so a changed or missing entry shows up in the chain check. Personal data in old and new values is masked."
        actions={
          <div className="flex gap-2">
            {canVerify ? <VerifyChain /> : null}
            <a className={btn.secondary} href={`/audit/export?${exportQs}`}>
              Export CSV
            </a>
          </div>
        }
      />
      <Card className="mb-4">
        <form className="grid gap-3 px-5 py-4 md:grid-cols-4" method="get">
          <label className="text-[13px]">
            Action (or prefix ending in a dot)
            <input name="action" defaultValue={sp.action} className={input} placeholder="points." />
          </label>
          <label className="text-[13px]">
            Admin id
            <input name="actorId" defaultValue={sp.actorId} className={input} />
          </label>
          <label className="text-[13px]">
            Target type
            <input name="targetType" defaultValue={sp.targetType} className={input} placeholder="member" />
          </label>
          <label className="text-[13px]">
            Target id (member, admin, role)
            <input name="targetId" defaultValue={sp.targetId} className={input} />
          </label>
          <label className="text-[13px]">
            Outcome
            <select name="outcome" defaultValue={sp.outcome ?? ''} className={input}>
              <option value="">Any</option>
              <option value="success">success</option>
              <option value="denied">denied</option>
              <option value="failure">failure</option>
            </select>
          </label>
          <label className="text-[13px]">
            From
            <input type="date" name="from" defaultValue={sp.from} className={input} />
          </label>
          <label className="text-[13px]">
            To
            <input type="date" name="to" defaultValue={sp.to} className={input} />
          </label>
          <div className="flex items-end gap-2">
            <button className={btn.primary}>Filter</button>
            <Link className={btn.ghost} href="/audit">
              Clear
            </Link>
          </div>
        </form>
      </Card>
      <Card>
        <Table head={['When (UTC)', 'Brand', 'Action', 'Outcome', 'Admin', 'Target', 'Change', 'Reason']}>
          {data.items.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="px-5 py-2.5 whitespace-nowrap">{fmtDate(e.at)}</td>
              <td className="px-5 py-2.5">{e.panel ? <PanelChip panel={e.panel} /> : '—'}</td>
              <td className="px-5 py-2.5 font-mono text-xs">{e.action}</td>
              <td className="px-5 py-2.5">
                <Badge tone={e.outcome === 'success' ? 'teal' : 'danger'}>{e.outcome}</Badge>
              </td>
              <td className="px-5 py-2.5 font-mono text-xs">
                {e.actorType}
                {e.actorId ? ` · ${e.actorId.slice(0, 8)}` : ''}
                {e.actorRole ? <span className="block text-fg-3">{e.actorRole}</span> : null}
              </td>
              <td className="px-5 py-2.5 font-mono text-xs">
                {e.targetType ? `${e.targetType} · ${String(e.targetId ?? '').slice(0, 24)}` : '—'}
              </td>
              <td className="max-w-sm px-5 py-2.5 font-mono text-[11px] text-fg-3">
                {e.before != null || e.after != null ? (
                  <>
                    <span className="block">old {JSON.stringify(e.before)}</span>
                    <span className="block">new {JSON.stringify(e.after)}</span>
                  </>
                ) : (
                  JSON.stringify(e.metadata)
                )}
              </td>
              <td className="max-w-xs px-5 py-2.5 text-[12px]">{e.reason ?? '—'}</td>
            </tr>
          ))}
        </Table>
        {data.nextBefore ? (
          <div className="border-t border-border px-5 py-3 text-right">
            <Link className={btn.secondary} href={`/audit?${older}`}>
              Older
            </Link>
          </div>
        ) : null}
      </Card>
    </>
  );
}
