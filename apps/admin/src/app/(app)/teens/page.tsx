import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, Table, fmt, fmtDate } from '@/components/ui';
import { ReasonAction } from '@/components/reason-action';
import { Graduate } from './graduate';

export const metadata: Metadata = { title: 'Teen Panel' };

interface Teen {
  id: string;
  name: string;
  birthYear: number | null;
  age: number | null;
  turns18: string | null;
  daysTo18: number | null;
  registration: { reference: string; status: string } | null;
  guardian: { relation: string; email: string; firstName: string } | null;
}

export default async function TeensPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const all = (await searchParams).all === '1';
  return (
    <>
      <PageHeader
        eyebrow="Teen Panel"
        title={all ? 'Teen members' : 'Turning 18'}
        description="Teens whose 18th birthday is within 30 days, or has passed. A teen who has turned 18 moves to an adult Consumer account on an admin's decision: answers and points stay, guardian links stop, and reward requests waiting for the guardian are cancelled with the points returned. Guardian details are masked."
        actions={
          <a className="text-[13px] text-accent" href={all ? '/teens' : '/teens?all=1'}>
            {all ? 'Show turning 18 only' : 'Show every teen'}
          </a>
        }
      />
      {await withPanel(async () => {
        const r = await api<{ total: number; due: number; items: Teen[] }>(
          `/panel/teens${all ? '' : '?turning18=30'}`,
        );
        return (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label={all ? 'Teen members' : 'Turning 18 in 30 days'} value={fmt(r.total)} />
              <Stat
                label="Already 18"
                value={fmt(r.due)}
                tone="accent"
                hint="Ready to move to an adult account"
              />
            </div>
            <Card>
              <CardHeader title="Teens" />
              {r.items.length === 0 ? (
                <EmptyState title="No one to show" />
              ) : (
                <Table head={['Teen', 'Age', '18th birthday', 'Registration', 'Guardian', '']}>
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
                        {t.registration ? `${t.registration.reference} · ${t.registration.status}` : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {t.guardian ? `${t.guardian.relation.replace('_', ' ')} · ${t.guardian.email}` : '—'}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {t.age !== null && t.age >= 18 ? <Graduate id={t.id} /> : null}
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
