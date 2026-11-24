import type { Metadata } from 'next';
import { api, ApiError } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmt, fmtDate } from '@/components/ui';
import { STATUS_TONE, marketingLabel, type MemberRow } from '../shared';
import { MemberActions } from './member-actions';
import { PointsQuality } from './points-quality';

export const metadata: Metadata = { title: 'Member' };

interface Detail extends MemberRow {
  fullName: string;
  gender: string | null;
  timezone: string | null;
  city: string | null;
  state: string | null;
  phoneVerified: string;
  registrationStatus: string;
  statusReason: string | null;
  statusChangedAt: string | null;
  profileCheckedAt: string | null;
  archivedAt: string | null;
  terms: string[];
  guardian: {
    email: string;
    relation: string | null;
    consent: boolean | null;
    consentVersion: string | null;
  } | null;
  teen: { status: string; reference: string } | null;
  points: Record<string, number>;
  counts: {
    surveys: Record<string, number>;
    answers: number;
    redemptions: number;
    tickets: number;
    ledgerEntries: number;
  };
  segmentChanges: { from: string; to: string; reason: string; at: string }[];
  /** Newest first, at most 20 (panel admin member detail). */
  marketingOptInHistory?: { granted: boolean; at: string; source: string; wording: string; by: string }[];
  canUnmask: boolean;
}
interface Ledger {
  entries: {
    at?: string;
    createdAt?: string;
    type?: string;
    kind?: string;
    points: number;
    remarks?: string;
    label?: string;
  }[];
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPanel(async () => {
    const m = await api<Detail>(`/panel/members/${encodeURIComponent(id)}`);
    let ledger: Ledger | null = null;
    try {
      ledger = await api<Ledger>(`/panel/members/${encodeURIComponent(id)}/ledger`);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) throw e;
    }
    const row = (k: string, v: React.ReactNode) => (
      <>
        <dt className="text-fg-3">{k}</dt>
        <dd>{v ?? '—'}</dd>
      </>
    );
    return (
      <>
        <PageHeader
          eyebrow="Panel · Members"
          title={m.fullName || m.name}
          description={`Member ${m.memberId ?? m.id}. Masked values stay masked until someone with the PII permission unmasks them with a reason.`}
        />
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Overview" action={<Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-[13px] md:grid-cols-4">
              {row('E-mail', <span className="font-mono text-[12px]">{m.email}</span>)}
              {row('Phone', <span className="font-mono text-[12px]">{m.phone}</span>)}
              {row('Segment', m.category)}
              {row('Born', m.birthYear)}
              {row('Gender', m.gender)}
              {row('Country', m.country?.toUpperCase())}
              {row('City', m.city)}
              {row('Time zone', m.timezone)}
              {row('E-mail check', m.emailVerified)}
              {row('Phone check', m.phoneVerified)}
              {row('Quality score', m.qualityScore)}
              {row('Registration', m.registrationStatus)}
              {row('Signed up', fmtDate(m.signedUpAt))}
              {row('Last activity', fmtDate(m.lastActivityAt))}
              {row('Profile checked', fmtDate(m.profileCheckedAt))}
              {row('Terms', m.terms.join(', ') || '—')}
              {row(
                'Marketing e-mails',
                `${marketingLabel(m.marketingOptIn).text}${m.marketingOptIn?.asked ? ` (${m.marketingOptIn.source ?? '?'}, ${fmtDate(m.marketingOptIn.at)})` : ''}`,
              )}
              {m.marketingOptInHistory?.length
                ? row(
                    'Opt-in history',
                    m.marketingOptInHistory
                      .map((h) => `${h.granted ? 'yes' : 'no'} via ${h.source}, ${fmtDate(h.at)} (${h.wording})`)
                      .join(' · '),
                  )
                : null}
              {m.statusReason
                ? row('Status reason', `${m.statusReason} (${fmtDate(m.statusChangedAt)})`)
                : null}
              {m.guardian
                ? row(
                    'Guardian',
                    `${m.guardian.email}, ${m.guardian.relation ?? ''}, consent ${m.guardian.consent === true ? 'YES' : m.guardian.consent === false ? 'NO' : 'pending'} ${m.guardian.consentVersion ?? ''}`,
                  )
                : null}
              {m.teen ? row('Teen registration', `${m.teen.status} (${m.teen.reference})`) : null}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Points" hint="Worked out from the ledger" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-[13px]">
              {Object.entries(m.points).map(([k, v]) => row(k, <span className="num">{fmt(v)}</span>))}
            </dl>
            <CardHeader title="Activity" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-[13px]">
              {row('Profile answers', fmt(m.counts.answers))}
              {row(
                'Surveys',
                Object.entries(m.counts.surveys)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(', ') || '0',
              )}
              {row('Redemptions', fmt(m.counts.redemptions))}
              {row('Tickets', fmt(m.counts.tickets))}
            </dl>
          </Card>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2 grid gap-4">
            <Card>
              <CardHeader
                title="Points ledger"
                hint={ledger ? `${fmt(ledger.entries.length)} lines, newest first` : 'Needs points.read'}
              />
              {!ledger || ledger.entries.length === 0 ? (
                <EmptyState title={ledger ? 'No point movements yet' : 'Not shown for your role'} />
              ) : (
                <Table head={['When', 'Type', 'Points', 'Note']}>
                  {ledger.entries.slice(0, 50).map((e, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2">{fmtDate(e.at ?? e.createdAt ?? null)}</td>
                      <td className="px-5 py-2">{e.type ?? e.kind ?? '—'}</td>
                      <td className="num px-5 py-2">{fmt(e.points)}</td>
                      <td className="px-5 py-2 text-fg-2">{e.label ?? e.remarks ?? ''}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="Segment changes" />
              {m.segmentChanges.length === 0 ? (
                <EmptyState title="No segment changes" />
              ) : (
                <Table head={['When', 'From', 'To', 'Reason']}>
                  {m.segmentChanges.map((c, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2">{fmtDate(c.at)}</td>
                      <td className="px-5 py-2">{c.from}</td>
                      <td className="px-5 py-2">{c.to}</td>
                      <td className="px-5 py-2 text-fg-2">{c.reason}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
          <div className="grid content-start gap-4">
            <MemberActions
              member={{
                id: m.id,
                status: m.status,
                segment: m.segment,
                category: m.category,
                emailVerified: m.emailVerified,
                phoneVerified: m.phoneVerified,
              }}
              canUnmask={m.canUnmask}
            />
            <PointsQuality member={m.id} score={m.qualityScore ?? null} />
          </div>
        </div>
      </>
    );
  });
}
