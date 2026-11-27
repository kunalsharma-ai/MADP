import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmtDate } from '@/components/ui';
import { NewPage } from './content-forms';
import { KEY_LABEL, type PageSummary } from './shared';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Site & legal pages' };

const LEGAL = ['privacy', 'terms', 'gdpr', 'cookies'];

export default async function ContentPagesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="Site & legal pages"
        description="The privacy, terms, GDPR and cookie pages and other site pages of the brand picked at the top. Edits are drafts until published. A legal page needs a second admin to publish it. Until a page is published, the site shows its built-in text."
      />
      {await withPanel(async (brand) => {
        const rows = await api<PageSummary[]>('/panel/content');
        const missing = LEGAL.filter((k) => !rows.some((r) => r.key === k && r.lang === 'en'));
        return (
          <div className="grid gap-4">
            <NewPage missingLegal={missing} />
            <Card>
              <CardHeader
                title={`${rows.length} pages on ${brand.toUpperCase()}`}
                hint="Legal pages first. To download one page as Word or PDF, open it."
                action={
                  <DownloadMenu
                    screen="content"
                    title="Site and legal pages"
                    columns={[
                      { key: 'title', label: 'Page' },
                      { key: 'key', label: 'Key' },
                      { key: 'kind', label: 'Kind' },
                      { key: 'lang', label: 'Language' },
                      { key: 'live', label: 'Live version' },
                      { key: 'published', label: 'Published', type: 'date' },
                      { key: 'draft', label: 'Draft' },
                      { key: 'updated', label: 'Updated', type: 'date' },
                    ]}
                    rows={rows.map((p) => ({
                      title: p.live?.title ?? KEY_LABEL[p.key] ?? p.key,
                      key: p.key,
                      kind: p.kind,
                      lang: p.lang,
                      live: p.live ? `v${p.live.version}` : 'Built-in text',
                      published: p.live?.publishedAt ?? null,
                      draft: p.draft ? (p.draft.state === 'review' ? 'In review' : 'Editing') : 'None',
                      updated: p.updatedAt,
                    }))}
                  />
                }
              />
              {rows.length === 0 ? (
                <EmptyState title="No pages yet">
                  The site shows its built-in privacy, terms, GDPR and cookie text.
                </EmptyState>
              ) : (
                <Table head={['Page', 'Language', 'Live', 'Draft', 'Updated']}>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-2.5">
                        <Link href={`/content/${p.id}`} className="font-medium text-accent hover:underline">
                          {p.live?.title ?? KEY_LABEL[p.key] ?? p.key}
                        </Link>
                        <span className="ml-2 font-mono text-[11px] text-fg-3">{p.key}</span>
                        {p.kind === 'legal' ? (
                          <Badge tone="warn" className="ml-2">
                            Legal · four eyes
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-5 py-2.5">{p.lang}</td>
                      <td className="px-5 py-2.5">
                        {p.live ? (
                          <span>
                            v{p.live.version} · {fmtDate(p.live.publishedAt)}
                          </span>
                        ) : (
                          <span className="text-fg-3">Built-in text</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        {p.draft ? (
                          <Badge tone={p.draft.state === 'review' ? 'accent' : 'neutral'}>
                            {p.draft.state === 'review' ? 'In review' : 'Editing'}
                          </Badge>
                        ) : (
                          <span className="text-fg-3">None</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">{fmtDate(p.updatedAt)}</td>
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
