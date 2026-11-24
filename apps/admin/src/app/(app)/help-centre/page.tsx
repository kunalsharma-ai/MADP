import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmtDate } from '@/components/ui';
import { HelpEditor, HelpStatusButtons } from './help-forms';

export const metadata: Metadata = { title: 'Help centre' };

interface Entry {
  id: string;
  slug: string;
  topic: string;
  title: string;
  body: unknown[];
  types: string[];
  status: 'draft' | 'published' | 'archived';
  updatedAt: string;
}
const TONE = { draft: 'neutral', published: 'teal', archived: 'danger' } as const;

export default async function HelpCentrePage() {
  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Help centre"
        description="Questions and answers the team adds to the member Help centre, next to the built-in guides. Drafts are not shown. An entry teens can see may not mention money, the same rule the built-in teen help follows."
      />
      {await withPanel(async () => {
        const rows = await api<Entry[]>('/panel/help');
        return (
          <div className="grid gap-4">
            <HelpEditor />
            <Card>
              <CardHeader title={`${rows.length} entries`} />
              {rows.length === 0 ? (
                <EmptyState title="No entries yet">
                  The member Help centre shows its built-in content until you publish one.
                </EmptyState>
              ) : (
                <Table head={['Question', 'Topic', 'Shown to', 'Status', 'Updated', '']}>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{e.title}</p>
                        <p className="line-clamp-1 max-w-xl text-[12px] text-fg-3">
                          {e.body.map((b) => (typeof b === 'string' ? b : JSON.stringify(b))).join(' ')}
                        </p>
                      </td>
                      <td className="px-5 py-2.5">{e.topic}</td>
                      <td className="px-5 py-2.5">{e.types.length ? e.types.join(', ') : 'everyone'}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={TONE[e.status]}>{e.status}</Badge>
                      </td>
                      <td className="px-5 py-2.5">{fmtDate(e.updatedAt)}</td>
                      <td className="px-5 py-2.5">
                        <HelpStatusButtons id={e.id} status={e.status} />
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
