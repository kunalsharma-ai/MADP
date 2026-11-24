import type { Metadata } from 'next';
import Link from 'next/link';
import type { SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, DataModeBadge, EmptyState, PageHeader, Table, fmtDate } from '@/components/ui';
import { STATUS_LABEL, STATUS_TONE, type DraftDetail } from '../shared';
import { Builder } from './builder';
import { ReviewActions } from './review-actions';

export const metadata: Metadata = { title: 'Questionnaire draft' };

const KIND = { question: 'Question', options: 'Options', profile_pages: 'Pages' } as Record<string, string>;

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPanel(async (brand) => {
    const [d, me] = await Promise.all([
      api<DraftDetail>(`/questionnaires/drafts/${encodeURIComponent(id)}`),
      api<SessionUser>('/auth/me'),
    ]);
    const perms = me.brandPermissions[brand] ?? [];
    const canEdit = perms.includes('qb.edit');
    const canPublish = perms.includes('qb.publish');
    const own = d.createdBy === me.id || d.submittedBy === me.id;
    const errors = d.problems.filter((p) => p.level === 'error');
    const warnings = d.problems.filter((p) => p.level === 'warning');
    return (
      <>
        <PageHeader
          eyebrow={`Questionnaire builder · ${brand.toUpperCase()}`}
          title={d.name.charAt(0).toUpperCase() + d.name.slice(1)}
          description={d.note ?? `Draft for the ${d.category} profile ${d.slug}.`}
          actions={
            <div className="flex items-center gap-2">
              <DataModeBadge mode={d.dataMode} />
              <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            </div>
          }
        />
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="grid gap-4 xl:col-span-2">
            {d.status === 'draft' && canEdit ? (
              <Builder draft={d} />
            ) : (
              <Card>
                <CardHeader title="Pages" hint="As this draft would leave them. Locked once submitted." />
                <ol className="grid gap-3 px-5 py-4 text-[13px]">
                  {d.spec.pages.map((p, i) => (
                    <li key={i}>
                      <p className="font-medium">
                        {i + 1}. {p.title}
                      </p>
                      <ul className="mt-1 grid gap-0.5 pl-4 font-mono text-[12px] text-fg-2">
                        {p.questions.map((q) => (
                          <li key={q}>
                            {q}
                            {d.spec.rules[q]?.parent
                              ? ` · when ${d.spec.rules[q]!.parent}${d.spec.rules[q]!.values.length ? ` is ${d.spec.rules[q]!.values.join(' or ')}` : ' is answered'}`
                              : d.spec.rules[q]
                                ? ' · always'
                                : ''}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </div>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader
                title={d.status === 'applied' ? 'What was written' : 'What applying writes'}
                hint="In this order, through the panel's admin API. Nothing is written before a second admin approves."
              />
              {d.writes.length === 0 ? (
                <EmptyState title="No changes yet">Edit the pages or the show logic.</EmptyState>
              ) : (
                <Table head={['Write', 'Change']}>
                  {d.writes.map((w, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2 text-fg-2">{KIND[w.kind] ?? w.kind}</td>
                      <td className="px-5 py-2 font-mono text-[12px]">{w.summary}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Checks"
                hint="The panel's own rule: a question with a parent waits for it; a choice question shows the options whose condition holds the answer."
              />
              {d.problems.length === 0 ? (
                <p className="px-5 py-3 text-[13px] text-teal">No problems found.</p>
              ) : (
                <ul className="grid gap-1.5 px-5 py-3 text-[13px]">
                  {[...errors, ...warnings].map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <Badge tone={p.level === 'error' ? 'danger' : 'warn'}>{p.level === 'error' ? 'Fix' : 'Note'}</Badge>
                      <span>{p.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Review and publish" />
              <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 px-5 py-3 text-[13px]">
                <dt className="text-fg-3">Started</dt>
                <dd>{fmtDate(d.createdAt)}</dd>
                <dt className="text-fg-3">Submitted</dt>
                <dd>{fmtDate(d.submittedAt)}</dd>
                <dt className="text-fg-3">Reviewed</dt>
                <dd>
                  {fmtDate(d.reviewedAt)}
                  {d.reviewNote ? ` · ${d.reviewNote}` : ''}
                </dd>
                <dt className="text-fg-3">Applied</dt>
                <dd>{fmtDate(d.appliedAt)}</dd>
              </dl>
              {d.applyResult ? (
                <div className="border-t border-border px-5 py-3 text-[13px]">
                  <ul className="grid gap-1">
                    {d.applyResult.steps.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <Badge tone={s.ok ? 'teal' : 'danger'}>{s.ok ? 'Written' : 'Failed'}</Badge>
                        <span className="font-mono text-[12px]">
                          {KIND[s.kind] ?? s.kind} {s.target}
                          {s.error ? ` · ${s.error}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {d.applyResult.panelVersion ? (
                    <p className="mt-2 text-fg-2">
                      The panel opened question bank version {d.applyResult.panelVersion} for review.{' '}
                      <Link href="/question-bank" className="text-accent hover:underline">
                        Publish it in the question bank
                      </Link>{' '}
                      (a second admin).
                    </p>
                  ) : d.applyResult.versionError ? (
                    <p className="mt-2 text-warn">Written, but the panel version was not opened: {d.applyResult.versionError}</p>
                  ) : null}
                </div>
              ) : null}
              <ReviewActions
                id={d.id}
                status={d.status}
                canEdit={canEdit}
                canPublish={canPublish}
                own={own}
                errors={errors.length}
                changes={d.writes.length}
              />
            </Card>
          </div>
        </div>
      </>
    );
  });
}
