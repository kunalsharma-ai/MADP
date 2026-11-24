import type { Metadata } from 'next';
import Link from 'next/link';
import type { SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { ContentView } from '@/components/content-view';
import { Badge, Card, CardHeader, PageHeader, Table, fmtDate } from '@/components/ui';
import { PageEditor, RestoreButton } from '../content-forms';
import { KEY_LABEL, type PageSummary, type Revision } from '../shared';

export const metadata: Metadata = { title: 'Site page' };

export default async function ContentPageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPanel(async (brand) => {
    const path = `/panel/content/${encodeURIComponent(id)}`;
    const [p, revisions, me] = await Promise.all([api<PageSummary>(path), api<Revision[]>(`${path}/revisions`), api<SessionUser>('/auth/me')]);
    const draft = p.draft && p.draft.title !== undefined && p.draft.body ? { ...p.draft, title: p.draft.title, body: p.draft.body } : null;
    const live = p.live?.body ? { title: p.live.title, body: p.live.body } : null;
    return (
      <>
        <PageHeader
          eyebrow={`Site & legal pages · ${brand.toUpperCase()}`}
          title={p.live?.title ?? draft?.title ?? KEY_LABEL[p.key] ?? p.key}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px]">
                {p.key} · {p.lang}
              </span>
              {p.kind === 'legal' ? <Badge tone="warn">Legal: a second admin publishes</Badge> : <Badge>Page</Badge>}
              {p.live ? (
                <Badge tone="teal">
                  Live v{p.live.version} since {fmtDate(p.live.publishedAt)}
                </Badge>
              ) : (
                <Badge>Not published: the site shows its built-in text</Badge>
              )}
            </span>
          }
          actions={
            <Link href="/content" className="text-[13px] text-accent underline">
              All pages
            </Link>
          }
        />
        <div className="grid gap-4">
          <PageEditor id={p.id} kind={p.kind} me={me.id} draft={draft} live={live} />
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Published versions" hint="Copy an old version into the draft to roll back; it then goes through review again." />
              {revisions.length === 0 ? (
                <p className="px-5 py-3 text-[13px] text-fg-3">Nothing published yet.</p>
              ) : (
                <Table head={['Version', 'Title', 'Published', '']}>
                  {revisions.map((r) => (
                    <tr key={r.version}>
                      <td className="px-5 py-2">v{r.version}</td>
                      <td className="px-5 py-2">{r.title}</td>
                      <td className="px-5 py-2">{fmtDate(r.publishedAt)}</td>
                      <td className="px-5 py-2 text-right">
                        <RestoreButton id={p.id} version={r.version} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            {live ? (
              <Card>
                <CardHeader title="Live now" hint="What members see on the site today." />
                <div className="px-5 py-4">
                  <ContentView title={live.title} body={live.body} />
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </>
    );
  });
}
