import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, Table, fmt, fmtDate } from '@/components/ui';
import { ReasonAction } from '@/components/reason-action';
import { Graduate } from './graduate';

export const metadata: Metadata = { title: 'Teen Panel' };

import { DownloadMenu } from '@/components/files';

interface Teen {
  id: string;
  name: string;
  birthYear: number | null;
  age: number | null;
  turns18: string | null;
  daysTo18: number | null;
  registration: { reference: string; status: string } | null;
  guardian: { relation: string; email: string; firstName: string } | null;
  adultMove: {
    stage: string | null;
    since?: string | null;
    deadline?: string | null;
    notifiedAt?: string | null;
  } | null;
}

type View = 'turning' | 'waiting' | 'all';
const VIEWS: { key: View; label: string; query: string }[] = [
  { key: 'turning', label: 'Turning 18 in 30 days', query: '?turning18=30' },
  { key: 'waiting', label: 'Waiting to accept adult terms', query: '?stage=turning_adult' },
  { key: 'all', label: 'Every teen', query: '' },
];

export default async function TeensPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const v = (await searchParams).view;
  const view: View = v === 'waiting' || v === 'all' ? v : 'turning';
  const all = view === 'all';
  return (
    <>
      <PageHeader
        eyebrow="Teen Panel"
        title="Turning 18"
        description="Guardian consent ends at 18. Thirty days before, the teen and guardian get a notice (an e-mail switch, off until Kunal turns it on). On the birthday the account pauses until the member accepts adult terms in their own name. Answers and points stay, while the answers the parent gave and the guardian's details are deleted. Accounts not accepted within 60 days close: unspent points lapse and a delete request opens. Support can move a member now or close the account, each with a reason. Guardian details are masked."
        actions={
          <a className="text-[13px] text-accent" href="/teens/registrations">
            Registration pipeline
          </a>
        }
      />
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Teen lists">
        {VIEWS.map((x) => (
          <a
            key={x.key}
            href={x.key === 'turning' ? '/teens' : `/teens?view=${x.key}`}
            aria-current={x.key === view ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${x.key === view ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-2'}`}
          >
            {x.label}
          </a>
        ))}
      </nav>
      {await withPanel(async () => {
        const r = await api<{ total: number; due: number; items: Teen[] }>(
          `/panel/teens${VIEWS.find((x) => x.key === view)!.query}`,
        );
        return (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label={VIEWS.find((x) => x.key === view)!.label} value={fmt(r.total)} />
              <Stat
                label="Already 18"
                value={fmt(r.due)}
                tone="accent"
                hint={all ? undefined : 'Paused until they accept the adult terms'}
              />
            </div>
            <Card>
              <CardHeader
                title="Teens"
                action={
                  <DownloadMenu
                    screen="teens"
                    title="Teens"
                    subtitle={`Showing: ${VIEWS.find((v) => v.key === view)?.label ?? 'All teens'}`}
                    columns={[
                      { key: 'name', label: 'Teen' },
                      { key: 'born', label: 'Born', type: 'number' },
                      { key: 'age', label: 'Age', type: 'number' },
                      { key: 'turns18', label: '18th birthday', type: 'date' },
                      { key: 'days', label: 'Days to 18', type: 'number' },
                      { key: 'stage', label: 'Adult terms' },
                      { key: 'deadline', label: 'Deadline', type: 'date' },
                      { key: 'ref', label: 'Registration' },
                      { key: 'regStatus', label: 'Registration status' },
                      { key: 'guardian', label: 'Guardian' },
                      { key: 'relation', label: 'Relation' },
                      { key: 'gEmail', label: 'Guardian e-mail' },
                    ]}
                    rows={r.items.map((t) => ({
                      name: t.name,
                      born: t.birthYear,
                      age: t.age,
                      turns18: t.turns18,
                      days: t.daysTo18,
                      stage: t.adultMove?.stage?.replaceAll('_', ' ') ?? '',
                      deadline: t.adultMove?.deadline ?? null,
                      ref: t.registration?.reference ?? '',
                      regStatus: t.registration?.status ?? '',
                      guardian: t.guardian?.firstName ?? '',
                      relation: t.guardian?.relation ?? '',
                      gEmail: t.guardian?.email ?? '',
                    }))}
                  />
                }
              />
              {r.items.length === 0 ? (
                <EmptyState title="No one to show" />
              ) : (
                <Table head={['Teen', 'Age', '18th birthday', 'Adult terms', 'Registration', 'Guardian', '']}>
                  {r.items.map((t) => (
                    <tr key={t.id}>
                      <td className="px-5 py-2.5 font-medium">
                        {t.name}
                        <p className="text-[11px] text-fg-3">born {t.birthYear ?? '—'}</p>
                      </td>
                      <td className="num px-5 py-2.5">{t.age ?? '—'}</td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {fmtDate(t.turns18)}{' '}
                        {t.daysTo18 !== null && t.daysTo18 <= 0 ? (
                          <Badge tone="accent">18 now</Badge>
                        ) : t.daysTo18 !== null ? (
                          <span className="text-fg-3">in {t.daysTo18} days</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {t.adultMove?.stage === 'turning_adult' ? (
                          <>
                            <Badge tone="warn">Waiting</Badge>
                            <p className="text-[11px] text-fg-3">
                              closes {fmtDate(t.adultMove.deadline ?? null)}
                            </p>
                          </>
                        ) : t.adultMove?.stage ? (
                          <Badge>{t.adultMove.stage}</Badge>
                        ) : t.adultMove?.notifiedAt ? (
                          <span className="text-fg-3">notice sent {fmtDate(t.adultMove.notifiedAt)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {t.registration ? `${t.registration.reference} · ${t.registration.status}` : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {t.guardian ? `${t.guardian.relation.replace('_', ' ')} · ${t.guardian.email}` : '—'}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {t.age !== null && t.age >= 18 ? <Graduate id={t.id} /> : null}
                          {t.adultMove?.stage === 'turning_adult' ? (
                            <ReasonAction
                              op={{ op: 'teen-close', id: t.id }}
                              label="Close account"
                              done="Account closed; a delete request is open"
                              danger
                            />
                          ) : null}
                          <ReasonAction
                            op={{ op: 'teen-revoke', id: t.id }}
                            label="Stop guardian links"
                            done="Guardian links stopped"
                            danger
                          />
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
