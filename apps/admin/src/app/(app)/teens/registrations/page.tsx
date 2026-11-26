import type { Metadata } from 'next';
import { TEEN_REGISTRATION_STATUSES, type TeenRegistrationStatus } from '@madp/contracts';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmt, fmtDate } from '@/components/ui';
import { ReasonAction } from '@/components/reason-action';

export const metadata: Metadata = { title: 'Teen registrations' };

import { DownloadMenu } from '@/components/files';

interface Registration {
  id: string;
  reference: string;
  status: TeenRegistrationStatus;
  teen: string;
  birthYear: number | null;
  guardian: { relation: string | null; email: string };
  expiresAt: string | null;
  updatedAt: string;
  lastNote: string | null;
  lastBy: string | null;
  actions: ('approve' | 'cancel' | 'renew')[];
}

const LABEL: Record<TeenRegistrationStatus, string> = {
  initial_registration: 'Initial registration',
  pending_guardian_approval: 'Waiting for guardian',
  guardian_approved: 'Guardian approved',
  pending_onboarding: 'Guardian onboarding',
  pending_consent: 'Guardian consent',
  manual_review: 'Manual review',
  pending_password: 'Teen password',
  active: 'Active',
  rejected: 'Rejected',
  expired: 'Expired',
  cancelled: 'Cancelled',
};
const FINAL = new Set<TeenRegistrationStatus>(['active', 'rejected', 'cancelled']);
const ACTION: Record<'approve' | 'cancel' | 'renew', { label: string; done: string; danger?: boolean }> = {
  approve: { label: 'Approve', done: 'Approved: the guardian continues with consent' },
  renew: { label: 'Renew link', done: 'A fresh invitation went to the guardian' },
  cancel: { label: 'Cancel', done: 'Registration cancelled', danger: true },
};

export default async function TeenRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const s = (await searchParams).status;
  const status = (TEEN_REGISTRATION_STATUSES as readonly string[]).includes(s ?? '')
    ? (s as TeenRegistrationStatus)
    : undefined;
  return (
    <>
      <PageHeader
        eyebrow="Teen Panel"
        title="Registration pipeline"
        description="Every Teen Panel registration by status. A registration moves only along the paths the panel allows: support can approve a manual review (the guardian then gives consent), cancel an open registration, or renew an expired guardian invitation. Each decision needs a reason and is kept in the audit log. Guardian e-mails are masked."
        actions={
          <a className="text-[13px] text-accent" href="/teens">
            Turning 18
          </a>
        }
      />
      {await withPanel(async () => {
        const r = await api<{ counts: Record<TeenRegistrationStatus, number>; items: Registration[] }>(
          `/panel/teens/registrations${status ? `?status=${status}` : ''}`,
        );
        return (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {TEEN_REGISTRATION_STATUSES.map((k) => (
                <a
                  key={k}
                  href={`/teens/registrations?status=${k}`}
                  aria-current={status === k ? 'page' : undefined}
                  className={`rounded-xl border px-3 py-2.5 ${status === k ? 'border-accent bg-accent-soft' : 'border-border bg-surface'}`}
                >
                  <p className="text-[11.5px] text-fg-3">{LABEL[k]}</p>
                  <p
                    className={`num text-[20px] font-semibold ${k === 'manual_review' && r.counts[k] ? 'text-warn' : ''}`}
                  >
                    {fmt(r.counts[k] ?? 0)}
                  </p>
                </a>
              ))}
            </div>
            <Card>
              <CardHeader
                title={status ? LABEL[status] : 'Open registrations'}
                hint={status ? undefined : 'Everything not yet active, rejected or cancelled.'}
                action={
                  <span className="flex flex-wrap items-center gap-3">
                    {status ? (
                      <a className="text-[12.5px] text-accent" href="/teens/registrations">
                        Show open ones
                      </a>
                    ) : null}
                    <DownloadMenu
                      screen="teen_registrations"
                      title="Teen registrations"
                      subtitle={`Showing: ${status ? LABEL[status] : 'Open registrations'}`}
                      columns={[
                        { key: 'reference', label: 'Reference' },
                        { key: 'teen', label: 'Teen' },
                        { key: 'born', label: 'Born', type: 'number' },
                        { key: 'status', label: 'Status' },
                        { key: 'relation', label: 'Guardian' },
                        { key: 'email', label: 'Guardian e-mail' },
                        { key: 'expires', label: 'Expires', type: 'date' },
                        { key: 'note', label: 'Last note' },
                        { key: 'by', label: 'By' },
                        { key: 'updated', label: 'Last change', type: 'date' },
                      ]}
                      rows={r.items.map((x) => ({
                        reference: x.reference,
                        teen: x.teen,
                        born: x.birthYear,
                        status: LABEL[x.status] ?? x.status,
                        relation: x.guardian.relation,
                        email: x.guardian.email,
                        expires: x.expiresAt,
                        note: x.lastNote,
                        by: x.lastBy,
                        updated: x.updatedAt,
                      }))}
                    />
                  </span>
                }
              />
              {r.items.length === 0 ? (
                <EmptyState title="Nothing here" />
              ) : (
                <Table head={['Reference', 'Teen', 'Status', 'Guardian', 'Last change', '']}>
                  {r.items.map((x) => (
                    <tr key={x.id}>
                      <td className="whitespace-nowrap px-5 py-2.5 font-mono text-[12px]">{x.reference}</td>
                      <td className="px-5 py-2.5">
                        {x.teen}
                        <p className="text-[11px] text-fg-3">born {x.birthYear ?? '—'}</p>
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge
                          tone={
                            x.status === 'manual_review' ? 'warn' : FINAL.has(x.status) ? 'neutral' : 'accent'
                          }
                        >
                          {LABEL[x.status]}
                        </Badge>
                        {x.expiresAt && !FINAL.has(x.status) ? (
                          <p className="text-[11px] text-fg-3">
                            {x.status === 'expired' ? 'link ran out' : 'link until'} {fmtDate(x.expiresAt)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {(x.guardian.relation ?? '').replace('_', ' ')} · {x.guardian.email}
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {fmtDate(x.updatedAt)}
                        {x.lastNote ? (
                          <p className="max-w-72 truncate text-[11px] text-fg-3" title={x.lastNote}>
                            {x.lastBy}: {x.lastNote}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {x.actions.map((a) => (
                            <ReasonAction
                              key={a}
                              op={{ op: 'teen-registration', id: x.id, action: a }}
                              label={ACTION[a].label}
                              done={ACTION[a].done}
                              danger={ACTION[a].danger}
                            />
                          ))}
                        </div>
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
