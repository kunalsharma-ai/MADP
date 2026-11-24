import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmtDate } from '@/components/ui';
import { ExpertDecision } from '@/components/expert-decision';

export const metadata: Metadata = { title: 'Expert verification' };

interface Item {
  id: string;
  status: 'requested' | 'verified' | 'declined';
  member: {
    id: string;
    name: string;
    segment: string | null;
    qualityScore?: number | null;
    memberStatus?: string;
  };
  linkedin: string | null;
  workEmail: string | null;
  workDomain: string | null;
  jobTitle: string | null;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
}
interface Detail extends Item {
  adminNote: string | null;
  memberSince: string | null;
  completedSurveys: number;
  verifiedAtSameDomain: number;
  history: { status: string; at: string; by: string }[];
}
const TABS = [
  ['requested', 'Waiting'],
  ['verified', 'Verified'],
  ['declined', 'Declined'],
  ['all', 'All'],
] as const;
const tone = (s: string) => (s === 'verified' ? 'teal' : s === 'declined' ? 'danger' : 'accent');

export default async function ExpertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const status = TABS.some(([k]) => k === sp.status) ? (sp.status as string) : 'requested';
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Expert verification"
        description="Professionals who asked to be shown as verified experts. Check the LinkedIn profile and the work e-mail domain by hand, then verify or decline. A decline needs a short note the member sees. Nothing is e-mailed, and every look and decision is in the audit log."
      />
      {await withPanel(async () => {
        const r = await api<{ total: number; counts: Record<string, number>; items: Item[] }>(
          `/panel/experts?status=${status}`,
        );
        const detail =
          sp.id && /^[a-f0-9]{24}$/i.test(sp.id) ? await api<Detail>(`/panel/experts/${sp.id}`) : null;
        return (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              {TABS.map(([k, label]) => (
                <Link
                  key={k}
                  href={`/experts?status=${k}`}
                  className={`rounded-full border px-3 py-1 text-[12.5px] ${k === status ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-2 hover:bg-surface-2'}`}
                >
                  {label}
                  {k !== 'all' ? <span className="ml-1.5 text-fg-3">{r.counts[k] ?? 0}</span> : null}
                </Link>
              ))}
            </div>
            {detail ? (
              <Card>
                <CardHeader
                  title={`${detail.member.name}: ${detail.jobTitle ?? 'no job title given'}`}
                  hint={`Member since ${fmtDate(detail.memberSince)} · ${detail.completedSurveys} completed survey${detail.completedSurveys === 1 ? '' : 's'} · quality ${detail.member.qualityScore ?? '—'}`}
                  action={
                    <Link
                      className="text-[12.5px] text-fg-3 hover:text-fg"
                      href={`/experts?status=${status}`}
                    >
                      Close
                    </Link>
                  }
                />
                <div className="grid gap-4 px-5 pb-5 text-[13px] sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-fg-3">LinkedIn</p>
                    {detail.linkedin ? (
                      <a
                        className="break-all text-accent hover:underline"
                        href={detail.linkedin}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {detail.linkedin}
                      </a>
                    ) : (
                      <p className="text-fg-3">Not given</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-fg-3">Work e-mail</p>
                    <p className="font-mono text-[12px]">{detail.workEmail ?? '—'}</p>
                    {detail.workDomain ? (
                      <p className="text-fg-3">
                        {detail.verifiedAtSameDomain
                          ? `${detail.verifiedAtSameDomain} already verified at ${detail.workDomain}`
                          : `No one verified yet at ${detail.workDomain}`}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-fg-3">History</p>
                    {detail.history.length ? (
                      detail.history.map((h, i) => (
                        <p key={i} className="text-fg-2">
                          {h.status} · {fmtDate(h.at)} · {h.by.startsWith('madp:') ? 'console' : 'member'}
                        </p>
                      ))
                    ) : (
                      <p className="text-fg-3">—</p>
                    )}
                    {detail.note ? <p className="mt-1 text-fg-3">Note to member: “{detail.note}”</p> : null}
                  </div>
                </div>
                {detail.status === 'requested' ? (
                  <div className="border-t border-border px-5 py-3">
                    <ExpertDecision id={detail.id} canVerify={detail.member.segment === 'professional'} />
                  </div>
                ) : null}
              </Card>
            ) : null}
            <Card>
              <CardHeader
                title={`${r.total} ${status === 'all' ? 'requests' : TABS.find(([k]) => k === status)![1].toLowerCase()}`}
              />
              {r.items.length === 0 ? (
                <EmptyState title={status === 'requested' ? 'No one is waiting' : 'Nothing here'} />
              ) : (
                <Table head={['Member', 'Evidence', 'Asked', 'Status', '']}>
                  {r.items.map((x) => (
                    <tr key={x.id}>
                      <td className="px-5 py-2.5">
                        <Link
                          className="text-accent hover:underline"
                          href={`/experts?status=${status}&id=${x.id}`}
                        >
                          {x.member.name}
                        </Link>
                        <p className="text-[11px] text-fg-3">
                          {x.member.segment ?? '—'} · quality {x.member.qualityScore ?? '—'}
                        </p>
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {x.jobTitle ? <p>{x.jobTitle}</p> : null}
                        {x.linkedin ? (
                          <p className="truncate text-fg-2" style={{ maxWidth: '18rem' }}>
                            {x.linkedin.replace(/^https:\/\/(www\.)?/, '')}
                          </p>
                        ) : null}
                        {x.workDomain ? <p className="text-fg-3">@{x.workDomain}</p> : null}
                      </td>
                      <td className="px-5 py-2.5 text-[12px] text-fg-2">{fmtDate(x.requestedAt)}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={tone(x.status)}>{x.status === 'requested' ? 'waiting' : x.status}</Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        {x.status === 'requested' ? (
                          <ExpertDecision id={x.id} canVerify={x.member.segment === 'professional'} />
                        ) : x.note ? (
                          <span className="text-[12px] text-fg-3">“{x.note}”</span>
                        ) : null}
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
