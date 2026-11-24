import type { Metadata } from 'next';
import Link from 'next/link';
import { KIND_BASIS, MERGE_FIELD_SOURCE_LABELS, type AudienceCategory, type MailerTemplate, type MergeFieldSource, type PanelCode } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, CategoryChip, PageHeader, PanelChip, Table } from '@/components/ui';

export const metadata: Metadata = { title: 'Mailer' };

type Detail = {
  pack: { id: string; title: string; panel: PanelCode; category: AudienceCategory | null };
  template: MailerTemplate;
  fields: { field: string; source: MergeFieldSource | null; label: string; madpField: string | null; personal: boolean }[];
  liquid: string;
  text: string;
};

export default async function MailerPage({ params }: { params: Promise<{ pack: string; id: string }> }) {
  const { pack, id } = await params;
  const path = `/communications/mailers/${encodeURIComponent(pack)}/${encodeURIComponent(id)}`;
  const [d, p] = await Promise.all([api<Detail>(path), api<{ subject: string; preheader: string | null; html: string }>(`${path}/preview`)]);
  const t = d.template;
  return (
    <>
      <PageHeader
        eyebrow={d.pack.title}
        title={t.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PanelChip panel={d.pack.panel} />
            {d.pack.category ? <CategoryChip category={d.pack.category} /> : null}
            {t.campaignKind ? (
              <Badge tone="accent">Usable for MADP campaigns: {t.campaignKind.replaceAll('_', ' ')}</Badge>
            ) : (
              <Badge tone="teal">{t.internal ? 'Sent by the panel to the team' : 'Sent by the panel when this happens'}</Badge>
            )}
            {t.campaignKind && KIND_BASIS[t.campaignKind] === 'marketing' ? (
              <Badge tone="warn">Marketing: needs the member&apos;s email marketing opt-in</Badge>
            ) : t.campaignKind ? (
              <Badge>Needs accepted panel terms; unsubscribe link required</Badge>
            ) : t.transactional ? (
              <Badge>Transactional</Badge>
            ) : null}
          </span>
        }
        actions={
          <Link className="text-[13px] text-accent underline" href="/communications/mailers">
            All mailers
          </Link>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader title={p.subject} hint={p.preheader ?? undefined} />
          {/* Sandboxed: no scripts, no same-origin access. The designers' sample data, never a member's. */}
          <iframe title={`${t.name} preview`} sandbox="" srcDoc={p.html} className="h-[900px] w-full rounded-b-xl bg-white" />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="When it is sent" />
            <dl className="space-y-2 px-5 py-3 text-[13px]">
              <div>
                <dt className="text-fg-3">Trigger</dt>
                <dd>{t.trigger ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-3">Button</dt>
                <dd>{t.cta ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-3">Why the member gets it</dt>
                <dd>{t.reason ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-3">Subject lines</dt>
                <dd>
                  <ul className="list-disc pl-4">
                    {t.subjects.map((s) => (
                      <li key={s} className="font-mono text-[12px]">
                        {s}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Merge fields" hint="Where each value comes from when the email is sent" />
            <Table head={['Field', 'Comes from']}>
              {d.fields.map((f) => (
                <tr key={f.field}>
                  <td className="px-5 py-1.5 align-top font-mono text-[12px]">{f.field}</td>
                  <td className="px-5 py-1.5 text-[13px]">
                    {f.source ? MERGE_FIELD_SOURCE_LABELS[f.source] : <Badge tone="warn">Not mapped</Badge>}
                    <span className="block text-[12px] text-fg-3">
                      {f.label}
                      {f.personal ? ' · personal data' : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Plain text part" />
          <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap px-5 py-4 text-[12px]">{d.text}</pre>
        </Card>
        <Card>
          <CardHeader title="Liquid source" hint="What the panel's mail system renders" />
          <pre className="max-h-[480px] overflow-auto px-5 py-4 font-mono text-[11px]">{d.liquid}</pre>
        </Card>
      </div>
    </>
  );
}
