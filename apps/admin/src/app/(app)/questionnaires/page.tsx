import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, btn, fmtDate, input } from '@/components/ui';
import { startDraftAction } from '@/app/questionnaire-actions';
import { STATUS_TONE, STATUS_LABEL, type DraftSummary } from './shared';

export const metadata: Metadata = { title: 'Questionnaire builder' };

interface ProfileRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  questions: number;
}
const SEGMENTS = [
  ['b2c', 'Consumer (b2c)'],
  ['b2b', 'Business Professional (b2b)'],
  ['b2c-minor', 'Teen (b2c-minor)'],
] as const;

export default async function QuestionnairesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; error?: string }>;
}) {
  const { category = 'b2c', error } = await searchParams;
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Questionnaire builder"
        description="Change a profile's pages, the questions it asks and when each one shows. A draft stays in MADP until a second admin approves it; only then is it written to the panel, and the panel opens a question bank version for its own review."
      />
      {await withPanel(async (brand) => {
        const [drafts, profiles] = await Promise.all([
          api<DraftSummary[]>('/questionnaires/drafts'),
          api<ProfileRow[]>(`/panel/profiles?category=${encodeURIComponent(category)}`),
        ]);
        const open = new Set(drafts.filter((d) => ['draft', 'review', 'approved'].includes(d.status)).map((d) => `${d.category}|${d.slug}`));
        return (
          <div className="grid gap-4">
            {error ? (
              <Card>
                <p className="px-5 py-3 text-[13px] text-danger">{error}</p>
              </Card>
            ) : null}
            <Card>
              <CardHeader title="Start a draft" hint={`From a ${brand.toUpperCase()} profile as the panel has it now.`} />
              <form method="get" className="flex flex-wrap items-end gap-2 px-5 pt-3 text-[13px]">
                <label>
                  Segment
                  <select name="category" defaultValue={category} className={input}>
                    {SEGMENTS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <button className={btn.secondary}>Show profiles</button>
              </form>
              <form action={startDraftAction} className="flex flex-wrap items-end gap-2 px-5 pt-3 pb-4 text-[13px]">
                <input type="hidden" name="category" value={category} />
                <label className="min-w-56">
                  Profile
                  <select name="slug" className={input} required>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.slug} disabled={open.has(`${p.category}|${p.slug}`)}>
                        {p.name} ({p.slug}, {p.questions} questions){open.has(`${p.category}|${p.slug}`) ? ' – draft open' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-72 flex-1">
                  What it is for
                  <input name="note" maxLength={500} placeholder="e.g. Ask car questions only of car owners" className={input} />
                </label>
                <button className={btn.primary} disabled={!profiles.length}>
                  Start draft
                </button>
              </form>
            </Card>
            <Card>
              <CardHeader title={`${drafts.length} drafts`} hint="Newest first. Applied and discarded drafts stay as a record." />
              {drafts.length === 0 ? (
                <EmptyState title="No drafts yet">Start one from a profile above.</EmptyState>
              ) : (
                <Table head={['Profile', 'Segment', 'Status', 'Changes', 'Checks', 'Note', 'Updated']}>
                  {drafts.map((d) => (
                    <tr key={d.id} className="hover:bg-surface-2">
                      <td className="px-5 py-2.5">
                        <Link href={`/questionnaires/${d.id}`} className="font-medium capitalize text-accent hover:underline">
                          {d.name}
                        </Link>
                        <div className="font-mono text-[11px] text-fg-3">{d.slug}</div>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{d.category}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                      </td>
                      <td className="num px-5 py-2.5">{d.changes}</td>
                      <td className="px-5 py-2.5">
                        {d.errors ? (
                          <Badge tone="danger">{d.errors} to fix</Badge>
                        ) : d.warnings ? (
                          <Badge tone="warn">{d.warnings} warnings</Badge>
                        ) : (
                          <Badge tone="teal">OK</Badge>
                        )}
                      </td>
                      <td className="max-w-80 truncate px-5 py-2.5 text-fg-2">{d.note ?? '—'}</td>
                      <td className="px-5 py-2.5">{fmtDate(d.updatedAt)}</td>
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
