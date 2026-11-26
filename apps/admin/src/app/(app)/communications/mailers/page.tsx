import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type MailerPack, type MailerTemplate, type PanelCode } from '@madp/contracts';
import { api } from '@/lib/api';
import {
  Badge,
  Card,
  CardHeader,
  CategoryChip,
  EmptyState,
  PageHeader,
  PanelChip,
  Table,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Mailer library' };

type Row = MailerTemplate & { unmappedFields: string[] };
type List = { importedAt: string; packs: (Omit<MailerPack, 'templates'> & { templates: Row[] })[] };

export default async function MailersPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; sent?: string }>;
}) {
  const panelList = await getPanels();
  const sp = await searchParams;
  const panel = panelList.map((x) => x.code).includes(sp.panel ?? '') ? (sp.panel as PanelCode) : undefined;
  const sent = sp.sent === 'panel' || sp.sent === 'madp' ? sp.sent : undefined;
  const data = await api<List>(`/communications/mailers${panel ? `?panel=${panel}` : ''}`);
  const keep = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams(
      Object.entries({ panel, sent, ...o }).filter((e): e is [string, string] => !!e[1]),
    );
    return `/communications/mailers${q.size ? `?${q}` : ''}`;
  };
  const show = (t: Row) => !sent || (sent === 'madp' ? !!t.campaignKind : !t.campaignKind);
  const total = data.packs.reduce((n, p) => n + p.templates.length, 0);
  const forMadp = data.packs.reduce((n, p) => n + p.templates.filter((t) => t.campaignKind).length, 0);
  return (
    <>
      <PageHeader
        eyebrow="Engagement"
        title="Mailer library"
        description={`The panels' own email templates from your mailer packs: ${total} templates in ${data.packs.length} packs, imported ${data.importedAt}. ${forMadp} can be used for MADP campaigns; the rest are system emails the panel sends when something happens (sign-up, password, support). Nothing is sent from this screen.`}
      />
      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-1.5 text-[13px]">
        {[undefined, ...panelList.map((x) => x.code)].map((p) => (
          <Link
            key={p ?? 'all'}
            href={keep({ panel: p })}
            className={cn(
              'rounded-full border border-border px-3 py-1',
              panel === p && 'border-accent bg-accent-soft text-accent',
            )}
          >
            {p ? panelShort(p, panelList) : 'Every panel'}
          </Link>
        ))}
        <span className="mx-2 text-fg-3">·</span>
        {([undefined, 'madp', 'panel'] as const).map((s) => (
          <Link
            key={s ?? 'any'}
            href={keep({ sent: s })}
            className={cn(
              'rounded-full border border-border px-3 py-1',
              sent === s && 'border-accent bg-accent-soft text-accent',
            )}
          >
            {s === 'madp'
              ? 'Usable for MADP campaigns'
              : s === 'panel'
                ? 'Sent by the panel'
                : 'All templates'}
          </Link>
        ))}
      </nav>
      {data.packs.length === 0 ? <EmptyState title="No mailer packs for this brand" /> : null}
      <div className="space-y-4">
        {data.packs.map((p) => {
          const rows = p.templates.filter(show);
          if (!rows.length) return null;
          return (
            <Card key={p.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <PanelChip panel={p.panel} /> {p.title}{' '}
                    {p.category ? <CategoryChip category={p.category} /> : null}
                  </span>
                }
                hint={`${rows.length} of ${p.templates.length} templates`}
                action={
                  <DownloadMenu
                    screen="mailers"
                    title={`Mailer library · ${p.title}`}
                    columns={[
                      { key: 'name', label: 'Template' },
                      { key: 'group', label: 'Group' },
                      { key: 'sentBy', label: 'Sent by' },
                      { key: 'subject', label: 'Sample subject' },
                      { key: 'fields', label: 'Merge fields' },
                      { key: 'unmapped', label: 'Not mapped' },
                    ]}
                    rows={rows.map((t) => ({
                      name: t.name,
                      group: t.group,
                      sentBy: t.campaignKind
                        ? `MADP campaign: ${t.campaignKind.replaceAll('_', ' ')}`
                        : t.internal
                          ? 'Panel, to the team'
                          : 'Panel, at the event',
                      subject: t.subjectsSample[0] ?? '',
                      fields: t.fields.join(', '),
                      unmapped: t.unmappedFields.join(', '),
                    }))}
                  />
                }
              />
              <Table head={['Template', 'Group', 'Sent by', 'Sample subject', 'Merge fields']}>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="px-5 py-2">
                      <Link
                        className="text-accent underline"
                        href={`/communications/mailers/${p.id}/${t.id}`}
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-5 py-2 text-fg-2">{t.group}</td>
                    <td className="px-5 py-2">
                      {t.campaignKind ? (
                        <Badge tone="accent">MADP campaign: {t.campaignKind.replaceAll('_', ' ')}</Badge>
                      ) : t.internal ? (
                        <Badge>Panel, to the team</Badge>
                      ) : (
                        <Badge tone="teal">Panel, at the event</Badge>
                      )}
                    </td>
                    <td className="max-w-[360px] truncate px-5 py-2 text-fg-2" title={t.subjectsSample[0]}>
                      {t.subjectsSample[0]}
                    </td>
                    <td className="px-5 py-2 font-mono text-[12px]">
                      {t.fields.length}
                      {t.unmappedFields.length ? (
                        <Badge tone="warn">{t.unmappedFields.length} not mapped</Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          );
        })}
      </div>
    </>
  );
}
