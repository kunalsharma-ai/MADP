import Link from 'next/link';
import { CheckCircle2, Coins, Flame, Gift, UserPlus, XCircle } from 'lucide-react';
import { Ring } from '@/components/dashboard/fx';
import { Badge, Card, CardHeader, EmptyState, Pager, Table, fmt, fmtDate } from '@/components/ui';
import { PANEL_TONES } from '@/lib/panel-tones';
import { STATUS_TONE, statusLabel } from '../../participation/status';
import { AlertsForm, PayoutClear } from './engagement-forms';
import { HELP, Titled } from '../../participation/help';
import type { TopicHelp } from '@/components/screen-info';

export interface Engagement {
  member: { id: string; type: string; teen: boolean; status: string; joinedAt: string | null; lastActivityAt: string | null };
  surveys: { byStatus: Record<string, number>; completeRate: number | null; points: number };
  points: { earned: number; cleared: number; pending: number; onHold: number; spent: number; available: number };
  streak: { current: number; best: number; todayDone: boolean; next: { days: number; points: number; daysLeft: number } | null; strip: { day: string; active: boolean }[] };
  profiles: { done: number; total: number } | null;
  referrals: {
    tiersOn: boolean;
    invitedWaiting: number;
    joined: number;
    verified: number;
    firstSurvey: number;
    counted: number;
    people: { id: string; name: string; joinedAt: string; stage: string; counts: boolean }[];
  } | null;
  tasks: Record<string, number>;
  alerts: {
    notifications: Record<string, boolean> & { quietHours?: { enabled: boolean; start: string; end: string } };
    survey: { invitesPerWeek: number | null; topics?: string[]; bestTimes?: string[] };
    leaderboard?: { optIn: boolean };
    pushDevices: number;
    whatsappAvailable: boolean;
  };
  payout: { current: string | null; used: { method: string; masked: string; lastUsed: string }[] } | null;
}
export interface Responses {
  total: number;
  page: number;
  size: number;
  items: { id: string; survey: string | null; status: string; points: number; loi: number | null; startedAt: string | null; endedAt: string | null; rating: number | null }[];
}

const STAGE: Record<string, string> = { joined: 'Joined', verified: 'E-mail verified', first_survey: 'Took a survey' };

/** Everything the member sees in their own member area, on one tab of the member page. */
export function MemberEngagement({
  e,
  r,
  brand,
  member,
  canEdit,
  path,
}: {
  e: Engagement;
  r: Responses | null;
  brand: string;
  member: string;
  canEdit: boolean;
  path: string;
}) {
  const [from, to] = PANEL_TONES[brand] ?? ['#818cf8', '#6366f1'];
  const rate = e.surveys.completeRate === null ? null : Math.round(e.surveys.completeRate * 100);
  const completes = e.surveys.byStatus.complete ?? 0;
  const terminates = e.surveys.byStatus.terminate ?? 0;
  return (
    <div className="mt-4 grid gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="flex items-center gap-4 p-5">
          <Ring value={rate ?? 0} max={100} size={84} stroke={9} from={from} to={to} label={`Complete rate ${rate ?? 0}%`}>
            <span className="text-center leading-tight">
              <span className="block text-[16px] font-bold">{rate === null ? '—' : `${rate}%`}</span>
              <span className="text-[9.5px] text-fg-3">complete</span>
            </span>
          </Ring>
          <div className="text-[12px]">
            <div className="text-[13px] font-semibold text-fg">
              <Titled title="Surveys" help={HELP.memberSurveys} />
            </div>
            <p className="mt-1 flex items-center gap-1 text-fg-2">
              <CheckCircle2 className="size-3.5 text-teal" aria-hidden /> {fmt(completes)} complete
            </p>
            <p className="flex items-center gap-1 text-fg-2">
              <XCircle className="size-3.5 text-danger" aria-hidden /> {fmt(terminates)} terminate
            </p>
            <p className="text-fg-3">{fmt(e.surveys.points)} points from surveys</p>
          </div>
        </Card>
        <Tile icon={Coins} tint="from-amber-400 to-orange-500" title="Points" help={HELP.memberPoints} big={fmt(e.points.available)} sub="available to redeem">
          {fmt(e.points.pending)} pending · {fmt(e.points.onHold)} on hold · {fmt(e.points.spent)} spent
        </Tile>
        <Tile icon={Flame} tint="from-pink-500 to-rose-500" title="Streak" help={HELP.memberStreak} big={`${e.streak.current} days`} sub={`best ${e.streak.best} days`}>
          <span className="mt-1 flex gap-[3px]" aria-label="Last 28 days">
            {e.streak.strip.map((d) => (
              <span
                key={d.day}
                title={d.day}
                className={`h-3 w-1.5 rounded-sm ${d.active ? 'bg-gradient-to-t from-pink-500 to-orange-400' : 'bg-surface-2'}`}
              />
            ))}
          </span>
          {e.streak.next ? (
            <span className="mt-1 block">
              {e.streak.next.daysLeft} more days for +{fmt(e.streak.next.points)} points
            </span>
          ) : null}
        </Tile>
        <Tile
          icon={UserPlus}
          tint="from-teal-400 to-emerald-500"
          title="Referrals"
        help={HELP.memberReferrals}
        align="right"
          big={e.referrals ? fmt(e.referrals.joined) : '—'}
          sub={e.referrals ? 'friends joined' : 'not for teens'}
        >
          {e.referrals
            ? `${fmt(e.referrals.firstSurvey)} took a survey · ${fmt(e.referrals.invitedWaiting)} invites waiting`
            : null}
          {e.profiles ? <span className="block">Profiles done: {e.profiles.done} of {e.profiles.total}</span> : null}
        </Tile>
      </div>

      <Card>
        <CardHeader title={<Titled title="Survey records" help={HELP.memberRecords} />} hint={r ? `${fmt(r.total)} surveys on this panel, newest first` : 'Not available'} />
        {!r || r.items.length === 0 ? (
          <EmptyState title="No surveys yet" />
        ) : (
          <Table head={['Started', 'Survey', 'Result', 'Points', 'Length', 'Rating']}>
            {r.items.map((x) => (
              <tr key={x.id}>
                <td className="whitespace-nowrap px-5 py-2 text-fg-2">{fmtDate(x.startedAt ?? x.endedAt)}</td>
                <td className="px-5 py-2">{x.survey ?? '—'}</td>
                <td className="px-5 py-2">
                  <Badge tone={STATUS_TONE[x.status] ?? 'neutral'}>{statusLabel(x.status)}</Badge>
                </td>
                <td className="num px-5 py-2">{x.points ? `+${fmt(x.points)}` : '0'}</td>
                <td className="num px-5 py-2 text-fg-2">{x.loi ? `${x.loi} min` : '—'}</td>
                <td className="px-5 py-2 text-fg-2">{x.rating ? '★'.repeat(x.rating) : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        {r ? <Pager total={r.total} page={r.page} size={r.size} path={path} params={{ tab: 'engagement' }} /> : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <AlertsForm member={member} alerts={e.alerts} canEdit={canEdit && !e.member.teen} />
        <Card>
          <CardHeader title={<Titled title="Payout method" help={HELP.memberPayout} />} hint="Only the method name and masked destinations leave the panel" />
          <div className="grid gap-3 px-5 py-4 text-[13px]">
            {e.payout === null ? (
              <p className="text-fg-3">Teen accounts have no payout method.</p>
            ) : (
              <>
                <p>
                  Saved method:{' '}
                  {e.payout.current ? <Badge tone="accent">{e.payout.current}</Badge> : <span className="text-fg-3">none</span>}
                </p>
                {e.payout.used.length ? (
                  <ul className="space-y-1 text-[12px] text-fg-2">
                    {e.payout.used.map((u) => (
                      <li key={u.method}>
                        <Gift className="mr-1 inline size-3.5 text-accent" aria-hidden />
                        {u.method} {u.masked} · last used {fmtDate(u.lastUsed)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-fg-3">No reward paid out yet.</p>
                )}
                {canEdit && e.payout.current ? <PayoutClear member={member} /> : null}
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={<Titled title="Referred friends" help={HELP.memberFriends} align="right" />} hint="Who joined with this member's link" />
          {!e.referrals || e.referrals.people.length === 0 ? (
            <EmptyState title={e.referrals ? 'Nobody yet' : 'Not for teens'} />
          ) : (
            <ul className="divide-y divide-border text-[13px]">
              {e.referrals.people.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-2">
                  <Link href={`/members/${p.id}`} className="text-accent hover:underline">
                    {p.name}
                  </Link>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
                    {fmtDate(p.joinedAt)}
                    <Badge tone={p.stage === 'first_survey' ? 'teal' : 'neutral'}>{STAGE[p.stage] ?? p.stage}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({
  icon: Icon,
  tint,
  title,
  help,
  align,
  big,
  sub,
  children,
}: {
  icon: typeof Coins;
  tint: string;
  title: string;
  help: TopicHelp;
  align?: 'left' | 'right';
  big: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <span className={`grid size-9 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm ${tint}`} aria-hidden>
          <Icon className="size-4.5" />
        </span>
        <div className="text-[13px] font-semibold text-fg">
          <Titled title={title} help={help} align={align} />
        </div>
      </div>
      <p className="num mt-3 text-[24px] font-bold leading-none text-fg">{big}</p>
      <p className="text-[11.5px] text-fg-3">{sub}</p>
      <div className="mt-2 text-[12px] text-fg-2">{children}</div>
    </Card>
  );
}
