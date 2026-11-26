import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  btn,
  fmt,
  fmtDate,
  input,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Quality & referrals' };

import { DownloadMenu } from '@/components/files';

interface Review {
  total: number;
  rows: {
    member: string;
    name: string;
    category: string;
    score: number;
    tier: string | null;
    status: string;
    rejectedResponses: number;
    lastRule: string | null;
    lastChangeAt: string | null;
  }[];
}
interface Fraud {
  notTracked: string[];
  referrers: {
    member: string;
    name: string | null;
    referrals: number;
    verified: number;
    finishedASurvey: number;
    inactiveShare: number;
  }[];
  sharedPayouts: { method: string; masked: string; members: string[]; points: number }[];
}
interface Tiers {
  scale: number;
  default: number;
  tiers: { key: string; label: string; min: number }[];
}

const NOT_TRACKED: Record<string, string> = { signup_ip: 'the sign-up IP address', device: 'the device' };

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const below = Number(sp.below ?? 60) || 60;
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Quality & referral checks"
        description="Members with a low quality score, lowest first. Score changes are made on the member page with a rule and a note, and each one is logged with the old and new score. The referral view only flags patterns; nothing here changes data."
      />
      {await withPanel(async () => {
        const [review, fraud, tiers] = await Promise.all([
          api<Review>(`/panel/quality/review?below=${below}`),
          api<Fraud>('/panel/referrals/fraud'),
          api<Tiers>('/panel/quality/tiers'),
        ]);
        return (
          <div className="grid gap-4">
            <Card>
              <CardHeader
                title="Tiers"
                hint={`Score runs 0 to ${tiers.scale}; members start at ${tiers.default}. Set in the panel's engagement config, read-only here.`}
              />
              <div className="flex flex-wrap gap-2 px-5 py-4">
                {tiers.tiers.map((t) => (
                  <Badge key={t.key} tone="accent">
                    {t.label} from {t.min}
                  </Badge>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader
                title={`${fmt(review.total)} members at or below ${below}`}
                action={
                  <DownloadMenu
                    screen="quality"
                    title="Quality review"
                    subtitle={`Score at or below ${below}`}
                    columns={[
                      { key: 'member', label: 'Member id' },
                      { key: 'name', label: 'Name' },
                      { key: 'segment', label: 'Segment' },
                      { key: 'score', label: 'Score', type: 'number' },
                      { key: 'tier', label: 'Tier' },
                      { key: 'status', label: 'Status' },
                      { key: 'rejected', label: 'Rejected responses', type: 'number' },
                      { key: 'rule', label: 'Last rule' },
                      { key: 'changed', label: 'Last change', type: 'date' },
                    ]}
                    rows={review.rows.map((r) => ({
                      member: r.member,
                      name: r.name,
                      segment: r.category,
                      score: r.score,
                      tier: r.tier,
                      status: r.status,
                      rejected: r.rejectedResponses,
                      rule: r.lastRule?.replaceAll('_', ' ') ?? '',
                      changed: r.lastChangeAt,
                    }))}
                  />
                }
              />
              <form className="flex items-end gap-2 px-5 pt-3 text-[13px]" method="get">
                <label>
                  Score at or below
                  <input
                    name="below"
                    type="number"
                    min={0}
                    max={200}
                    defaultValue={below}
                    className={input}
                  />
                </label>
                <button className={btn.secondary}>Show</button>
              </form>
              {review.rows.length === 0 ? (
                <EmptyState title="Nobody this low" />
              ) : (
                <Table
                  head={['Member', 'Segment', 'Score', 'Tier', 'Status', 'Rejected responses', 'Last change']}
                >
                  {review.rows.map((r) => (
                    <tr key={r.member}>
                      <td className="px-5 py-2.5">
                        <Link href={`/members/${r.member}`} className="text-accent hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-5 py-2.5">{r.category}</td>
                      <td className="num px-5 py-2.5 font-medium">{r.score}</td>
                      <td className="px-5 py-2.5">{r.tier ?? '—'}</td>
                      <td className="px-5 py-2.5">{r.status}</td>
                      <td className="num px-5 py-2.5">{fmt(r.rejectedResponses)}</td>
                      <td className="px-5 py-2.5">
                        {r.lastRule ? `${r.lastRule.replaceAll('_', ' ')}, ${fmtDate(r.lastChangeAt)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Referrers to check"
                action={
                  <DownloadMenu
                    screen="quality"
                    title="Referrers to check"
                    columns={[
                      { key: 'member', label: 'Member id' },
                      { key: 'name', label: 'Referrer' },
                      { key: 'referrals', label: 'Referrals', type: 'number' },
                      { key: 'verified', label: 'E-mail verified', type: 'number' },
                      { key: 'finished', label: 'Finished a survey', type: 'number' },
                      { key: 'inactive', label: 'Never took part (%)', type: 'number' },
                    ]}
                    rows={fraud.referrers.map((r) => ({
                      member: r.member,
                      name: r.name,
                      referrals: r.referrals,
                      verified: r.verified,
                      finished: r.finishedASurvey,
                      inactive: r.inactiveShare,
                    }))}
                  />
                }
                hint={`Members with 5 or more referrals, by how many of them never finished a survey. ${fraud.notTracked.length ? `The panel doesn't record ${fraud.notTracked.map((k) => NOT_TRACKED[k] ?? k).join(' or ')}, so those can't be compared.` : ''}`}
              />
              {fraud.referrers.length === 0 ? (
                <EmptyState title="No referrer with 5 or more referrals" />
              ) : (
                <Table
                  head={['Referrer', 'Referrals', 'E-mail verified', 'Finished a survey', 'Never took part']}
                >
                  {fraud.referrers.map((r) => (
                    <tr key={r.member}>
                      <td className="px-5 py-2.5">
                        <Link href={`/members/${r.member}`} className="text-accent hover:underline">
                          {r.name ?? r.member}
                        </Link>
                      </td>
                      <td className="num px-5 py-2.5">{fmt(r.referrals)}</td>
                      <td className="num px-5 py-2.5">{fmt(r.verified)}</td>
                      <td className="num px-5 py-2.5">{fmt(r.finishedASurvey)}</td>
                      <td className="px-5 py-2.5">
                        <Badge
                          tone={r.inactiveShare >= 80 ? 'danger' : r.inactiveShare >= 50 ? 'warn' : 'neutral'}
                        >
                          {r.inactiveShare}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Payout destinations shared by several members"
                hint="Shown masked. The full destination never leaves the panel."
                action={
                  <DownloadMenu
                    screen="quality"
                    title="Shared payout destinations"
                    columns={[
                      { key: 'method', label: 'Method' },
                      { key: 'masked', label: 'Destination (masked)' },
                      { key: 'members', label: 'Members' },
                      { key: 'count', label: 'How many', type: 'number' },
                      { key: 'points', label: 'Points paid', type: 'number' },
                    ]}
                    rows={fraud.sharedPayouts.map((g) => ({
                      method: g.method,
                      masked: g.masked,
                      members: g.members.join(', '),
                      count: g.members.length,
                      points: g.points,
                    }))}
                  />
                }
              />
              {fraud.sharedPayouts.length === 0 ? (
                <EmptyState title="No shared payout destinations" />
              ) : (
                <Table head={['Method', 'Destination', 'Members', 'Points paid']}>
                  {fraud.sharedPayouts.map((g, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2.5">{g.method}</td>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{g.masked}</td>
                      <td className="px-5 py-2.5">
                        {g.members.map((m) => (
                          <Link
                            key={m}
                            href={`/members/${m}`}
                            className="mr-2 font-mono text-[11px] text-accent hover:underline"
                          >
                            {m.slice(-6)}
                          </Link>
                        ))}
                      </td>
                      <td className="num px-5 py-2.5">{fmt(g.points)}</td>
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
