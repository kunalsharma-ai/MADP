import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, Table, fmt, fmtDate } from '@/components/ui';
import { ReasonAction } from '@/components/reason-action';
import { CatalogueForm, OfferForm } from './forms';

export const metadata: Metadata = { title: 'Rewards' };

interface Redemption {
  id: string;
  reference: string;
  item: { title?: string; kind?: string };
  points: number;
  status: string;
  payout: { method: string | null; masked: string };
  member: { name: string; email: string; teen: boolean } | null;
  createdAt: string;
}
interface Item {
  key: string;
  kind: string;
  title: string;
  points: number;
  value: number | null;
  audience: string[];
  active: boolean;
}
interface Draw {
  id: string;
  month: string;
  title: string;
  status: string;
  ticketPoints: number;
  countries: string[];
  closesAt: string;
  members: number;
  tickets: number;
}
interface Offer {
  id: string;
  title: string;
  multiplier: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
}

const TONE: Record<string, 'neutral' | 'accent' | 'teal' | 'warn' | 'danger'> = {
  requested: 'accent',
  guardian_pending: 'warn',
  approved: 'teal',
  fulfilled: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

function Actions({ r }: { r: Redemption }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.status === 'requested' ? (
        <ReasonAction
          op={{ op: 'redemption', id: r.id, status: 'approved' }}
          label="Approve"
          done="Approved"
        />
      ) : null}
      {r.status === 'approved' ? (
        <ReasonAction
          op={{ op: 'redemption', id: r.id, status: 'fulfilled' }}
          label="Mark paid"
          done="Marked paid"
          placeholder="How it was paid (reference)"
        />
      ) : null}
      {['requested', 'approved', 'guardian_pending'].includes(r.status) ? (
        <ReasonAction
          op={{ op: 'redemption', id: r.id, status: 'rejected' }}
          label="Reject"
          done="Rejected; the points are back"
          danger
        />
      ) : null}
    </div>
  );
}

export default async function RewardsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Rewards"
        description="The redemption queue, the catalogue, prize draws and bonus offers. Nothing here pays anyone: “Mark paid” records that the team paid a request by hand. Approving and paying need the brand's redemptions switch on; at the four-eyes amount a second admin marks it paid."
      />
      {await withPanel(async () => {
        const [q, items, draws, offers] = await Promise.all([
          api<{
            items: Redemption[];
            counts: Record<string, { n: number; points: number }>;
            switches: { redemptions: boolean; teenRedemptions: boolean };
            teensHidden: boolean;
          }>('/panel/redemptions?status=open'),
          api<Item[]>('/panel/rewards/catalogue'),
          api<{ enabled: boolean; items: Draw[] }>('/panel/draws'),
          api<Offer[]>('/panel/offers'),
        ]);
        const c = (s: string) => q.counts[s]?.n ?? 0;
        return (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Stat label="Waiting for a decision" value={fmt(c('requested'))} tone="accent" />
              <Stat label="Approved, not yet paid" value={fmt(c('approved'))} />
              <Stat label="Waiting for a guardian" value={fmt(c('guardian_pending'))} />
              <Stat
                label="Redemptions switch"
                value={q.switches.redemptions ? 'On' : 'Off'}
                hint={`Teen learning rewards: ${q.switches.teenRedemptions ? 'on' : 'off'}`}
                tone={q.switches.redemptions ? 'teal' : undefined}
              />
            </div>
            <Card>
              <CardHeader
                title="Redemption queue"
                hint={
                  q.teensHidden
                    ? 'Teen requests are hidden: they need teen access.'
                    : 'Oldest first. Payout addresses are always masked.'
                }
              />
              {q.items.length === 0 ? (
                <EmptyState title="Nothing waiting">
                  Requests appear here once members can redeem (the redemptions switch).
                </EmptyState>
              ) : (
                <Table head={['Request', 'Member', 'Reward', 'Points', 'Payout to', 'Status', '']}>
                  {q.items.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-mono text-[12px]">{r.reference}</p>
                        <p className="text-[11px] text-fg-3">{fmtDate(r.createdAt)}</p>
                      </td>
                      <td className="px-5 py-2.5">
                        <p>
                          {r.member?.name ?? '—'} {r.member?.teen ? <Badge tone="warn">Teen</Badge> : null}
                        </p>
                        <p className="text-[11px] text-fg-3">{r.member?.email}</p>
                      </td>
                      <td className="px-5 py-2.5">{r.item.title}</td>
                      <td className="num px-5 py-2.5">{fmt(r.points)}</td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {r.payout.method} · {r.payout.masked}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        <Actions r={r} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <CatalogueForm />
            <Card>
              <CardHeader
                title={`Catalogue (${fmt(items.length)})`}
                hint="While the catalogue is empty, members see the placeholder list from the engagement settings."
              />
              {items.length === 0 ? (
                <EmptyState title="No rewards yet" />
              ) : (
                <Table head={['Reward', 'Kind', 'Points', 'For', '']}>
                  {items.map((i) => (
                    <tr key={i.key}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{i.title}</p>
                        <p className="font-mono text-[11px] text-fg-3">{i.key}</p>
                      </td>
                      <td className="px-5 py-2.5">{i.kind}</td>
                      <td className="num px-5 py-2.5">{fmt(i.points)}</td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {i.audience.length ? i.audience.join(', ') : 'everyone'}
                      </td>
                      <td className="px-5 py-2.5">
                        {i.active ? <Badge tone="teal">Live</Badge> : <Badge>Retired</Badge>}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Prize draws"
                hint={
                  draws.enabled
                    ? 'The draw switch is on for this brand.'
                    : 'The draw switch is off: members see no draw and a draw can’t be run. It stays off until legal clears each country.'
                }
              />
              {draws.items.length === 0 ? (
                <EmptyState title="No draws" />
              ) : (
                <Table head={['Month', 'Draw', 'Countries', 'Entries', 'Status', '']}>
                  {draws.items.map((d) => (
                    <tr key={d.id}>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{d.month}</td>
                      <td className="px-5 py-2.5">
                        {d.title}
                        <p className="text-[11px] text-fg-3">closes {fmtDate(d.closesAt)}</p>
                      </td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {d.countries.join(', ').toUpperCase() || 'nowhere'}
                      </td>
                      <td className="num px-5 py-2.5">
                        {fmt(d.members)} members · {fmt(d.tickets)} tickets
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge>{d.status}</Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        {d.status === 'open' ? (
                          <div className="flex gap-1">
                            {draws.enabled ? (
                              <ReasonAction
                                op={{ op: 'draw', id: d.id, action: 'run' }}
                                label="Run draw"
                                done="Draw run"
                              />
                            ) : null}
                            <ReasonAction
                              op={{ op: 'draw', id: d.id, action: 'cancel' }}
                              label="Cancel"
                              done="Cancelled; tickets refunded"
                              danger
                            />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <OfferForm />
            <Card>
              <CardHeader title="Bonus offers" />
              {offers.length === 0 ? (
                <EmptyState title="No offers" />
              ) : (
                <Table head={['Offer', 'Multiplier', 'Runs', '']}>
                  {offers.map((o) => (
                    <tr key={o.id}>
                      <td className="px-5 py-2.5">{o.title}</td>
                      <td className="num px-5 py-2.5">{o.multiplier}×</td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {fmtDate(o.startsAt)} to {fmtDate(o.endsAt)}
                      </td>
                      <td className="px-5 py-2.5">
                        {o.active ? (
                          <ReasonAction
                            op={{ op: 'offer-end', id: o.id }}
                            label="End now"
                            done="Offer ended"
                            danger
                          />
                        ) : (
                          <Badge>Ended</Badge>
                        )}
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
