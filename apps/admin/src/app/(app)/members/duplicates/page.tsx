import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, btn, fmtDate } from '@/components/ui';
import type { MemberRow } from '../shared';
import { MergeGroup, UndoMerge } from './merge-tools';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Duplicate members' };

const RULES = [
  ['email', 'Same e-mail'],
  ['phone', 'Same phone'],
  ['name_dob', 'Same name and date of birth'],
  ['ip', 'Same sign-up IP'],
  ['device', 'Same device'],
] as const;

interface MergeRow {
  id: string;
  keep: string;
  duplicate: string;
  reason: string;
  actor: string | null;
  moved: Record<string, number>;
  createdAt: string;
  undoneAt: string | null;
}

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const sp = await searchParams;
  const by = RULES.some(([k]) => k === sp.by) ? sp.by! : 'email';
  return (
    <>
      <PageHeader
        eyebrow="Panel · Members"
        title="Duplicate members"
        description="Likely duplicate accounts in the brand picked at the top, with e-mail and phone masked. A merge always starts as a dry run that shows what moves; merging moves points and history to the kept account and closes the duplicate. Teen accounts are never merged. Every step is in the audit log, and a merge can be undone."
        actions={
          <Link href="/members" className={btn.secondary}>
            Back to members
          </Link>
        }
      />
      {await withPanel(async () => {
        type Found = {
          reason: string;
          groups: number;
          more: boolean;
          items: { reason: string; members: MemberRow[] }[];
        };
        const newer = by === 'ip' || by === 'device';
        const [found, history] = await Promise.all([
          api<{
            reason: string;
            groups: number;
            more: boolean;
            items: { reason: string; members: MemberRow[] }[];
          }>(`/panel/duplicates?by=${by}`),
          // a panel without the sign-up IP and device hashes yet (before MFR#104) rejects those two rules
          api<Found>(`/panel/duplicates?by=${by}`).catch((e) => {
            if (!newer) throw e;
            return null;
          }),
          api<{ items: MergeRow[] }>('/panel/duplicates/merges'),
        ]);
        return (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {RULES.map(([k, label]) => (
                <Link
                  key={k}
                  href={`/members/duplicates?by=${k}`}
                  className={k === by ? btn.primary : btn.secondary}
                >
                  {label}
                </Link>
              ))}
            </div>
            {found ? (
              <p className="text-[13px] text-fg-2">
                {found.reason}. {found.groups} group{found.groups === 1 ? '' : 's'}
                {found.more ? ' shown; more exist' : ''}.
              </p>
            ) : null}
            {!found ? (
              <Card>
                <EmptyState title="This panel does not record the sign-up IP and device yet">
                  The panel update that saves a one-way hash of them at sign-up is not live on this brand.
                  Members who sign up after it goes live are checked; older accounts never match.
                </EmptyState>
              </Card>
            ) : found.items.length === 0 ? (
              <Card>
                <EmptyState title="No duplicates found">Try another rule above.</EmptyState>
              </Card>
            ) : (
              found.items.map((g, i) => (
                <MergeGroup key={g.members.map((m) => m.id).join('-')} n={i + 1} members={g.members} />
              ))
            )}
            <Card>
              <CardHeader
                title="Merges"
                hint="Newest first. Undo puts every moved row back and reopens the duplicate."
                action={
                  <DownloadMenu
                    screen="duplicates"
                    title="Member merges"
                    columns={[
                      { key: 'at', label: 'When', type: 'date' },
                      { key: 'keep', label: 'Kept member' },
                      { key: 'dup', label: 'Closed member' },
                      { key: 'moved', label: 'Rows moved', type: 'number' },
                      { key: 'detail', label: 'What moved' },
                      { key: 'reason', label: 'Reason' },
                      { key: 'by', label: 'By' },
                      { key: 'undone', label: 'Undone', type: 'date' },
                    ]}
                    rows={history.items.map((m) => ({
                      at: m.createdAt,
                      keep: m.keep,
                      dup: m.duplicate,
                      moved: Object.values(m.moved).reduce((a, b) => a + b, 0),
                      detail: Object.entries(m.moved)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(', '),
                      reason: m.reason,
                      by: m.actor,
                      undone: m.undoneAt,
                    }))}
                  />
                }
              />
              {history.items.length === 0 ? (
                <EmptyState title="No merges yet" />
              ) : (
                <Table head={['When', 'Kept', 'Closed', 'Moved', 'Reason', '']}>
                  {history.items.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-2">{fmtDate(m.createdAt)}</td>
                      <td className="px-5 py-2">
                        <Link className="text-accent" href={`/members/${m.keep}`}>
                          {m.keep.slice(-6)}
                        </Link>
                      </td>
                      <td className="px-5 py-2">
                        <Link className="text-accent" href={`/members/${m.duplicate}`}>
                          {m.duplicate.slice(-6)}
                        </Link>
                      </td>
                      <td className="px-5 py-2">{Object.values(m.moved).reduce((a, b) => a + b, 0)} rows</td>
                      <td className="px-5 py-2 text-fg-2">{m.reason}</td>
                      <td className="px-5 py-2">
                        {m.undoneAt ? <Badge>Undone {fmtDate(m.undoneAt)}</Badge> : <UndoMerge id={m.id} />}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        );
      })}
    </>
  );
}
