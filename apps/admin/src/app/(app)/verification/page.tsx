import type { Metadata } from 'next';
import Link from 'next/link';
import { PANELS, VERIFICATION_CLAIMS, type DataMode, type PanelCode, type SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, Stat, Table, fmt, fmtDate } from '@/components/ui';
import { EvidenceSteps, NewEvidence } from './verification-forms';

export const metadata: Metadata = { title: 'Verification & data quality' };

type Counts = { verified: number; unverified: number; rejected: number };
type EvidenceCounts = { pending: number; verified: number; expired: number; rejected: number; revoked: number };
interface PanelQuality {
  panel: PanelCode;
  members: number;
  sourceReported: {
    email: Counts;
    phone: Counts;
    qualityScore: { none: number; below50: number; from50to99: number; from100to149: number; from150: number };
  };
  checks: Record<string, number>;
  evidence: Record<string, EvidenceCounts>;
  identityReviewOpen: number;
}
interface Summary {
  dataMode: DataMode;
  checks: { key: string; label: string; why: string }[];
  panels: PanelQuality[];
}
interface Evidence {
  id: string;
  personId: string;
  panel: PanelCode;
  claim: string;
  method: string;
  reference: string;
  status: string;
  expiresOn: string | null;
  expired: boolean;
  recordedBy: string;
  decisionNote: string | null;
  createdAt: string;
}
interface Drill {
  panel: PanelCode;
  check: string;
  label: string;
  why: string;
  items: { personId: string; sourceMember: string; qualityScore: number | null; emailVerification: string; country: string | null; timezone?: string | null }[];
}

const CLAIM_LABEL: Record<string, string> = {
  identity: 'Identity',
  age: 'Age',
  hcp_licence: 'HCP licence',
  employment: 'Employment',
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const human = (s: string) => s.replaceAll('_', ' ');

export default async function VerificationPage({ searchParams }: { searchParams: Promise<{ panel?: string; check?: string }> }) {
  const sp = await searchParams;
  const [me, s, ev] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<Summary>('/verification/summary'),
    api<{ items: Evidence[] }>('/verification/evidence'),
  ]);
  const canDrill = me.permissions.includes('panellists.read');
  const canReview = me.permissions.includes('verification.review');
  const drill =
    canDrill && sp.panel && sp.check && /^[a-z0-9_]+$/.test(sp.check) && /^(t2o|mfr|mho)$/.test(sp.panel)
      ? await api<Drill>(`/verification/checks?panel=${sp.panel}&check=${sp.check}`)
      : null;
  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Verification & data quality"
        description="What each panel reports about e-mail, phone and quality, MADP's own checks on its copy of every member record, and independent verification that one admin records and another decides. Panel by panel, never added together."
        actions={<DataModeBadge mode={s.dataMode} />}
      />
      <DemoBanner mode={s.dataMode} />
      <div className="space-y-4">
        {s.panels.map((p) => {
          const q = p.sourceReported.qualityScore;
          const bands: [string, number][] = [
            ['Not reported', q.none],
            ['Below 50', q.below50],
            ['50 to 99', q.from50to99],
            ['100 to 149', q.from100to149],
            ['150 and over', q.from150],
          ];
          const max = Math.max(1, ...bands.map((b) => b[1]));
          return (
            <Card key={p.panel}>
              <CardHeader title={PANELS[p.panel].name} hint="Verification and quality scores are as the panel reported them" />
              <div className="grid grid-cols-2 gap-3 px-5 py-4 md:grid-cols-4">
                <Stat label="Active members" value={fmt(p.members)} />
                <Stat label="E-mail verified (panel)" value={fmt(p.sourceReported.email.verified)} hint={`${pct(p.sourceReported.email.verified, p.members)} · ${fmt(p.sourceReported.email.rejected)} rejected`} />
                <Stat label="Phone verified (panel)" value={fmt(p.sourceReported.phone.verified)} hint={`${pct(p.sourceReported.phone.verified, p.members)} · ${fmt(p.sourceReported.phone.rejected)} rejected`} />
                <Stat
                  label="Identity matches to review"
                  value={fmt(p.identityReviewOpen)}
                  hint={<Link className="underline" href="/identity">Identity review</Link>}
                />
              </div>
              <div className="grid gap-4 border-t border-border px-5 py-4 lg:grid-cols-3">
                <div>
                  <h3 className="mb-2 text-[12px] font-medium text-fg-2">Quality score (members start at 100, maximum 200)</h3>
                  <ul className="space-y-1.5 text-[12px]">
                    {bands.map(([label, n]) => (
                      <li key={label} className="grid grid-cols-[96px_1fr_48px] items-center gap-2">
                        <span className="text-fg-2">{label}</span>
                        <span className="h-2 rounded bg-surface-2">
                          <span className="block h-2 rounded bg-accent" style={{ width: `${(n / max) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono">{fmt(n)}</span>
                      </li>
                    ))}
                  </ul>
                  <h3 className="mb-2 mt-5 text-[12px] font-medium text-fg-2">Independent verification (MADP)</h3>
                  <ul className="space-y-1 text-[12px]">
                    {VERIFICATION_CLAIMS.map((c) => {
                      const e = p.evidence[c];
                      return (
                        <li key={c} className="flex items-center justify-between gap-2">
                          <span className="text-fg-2">{CLAIM_LABEL[c]}</span>
                          <span className="flex flex-wrap justify-end gap-1">
                            {e ? (
                              <>
                                {e.verified ? <Badge tone="teal">{e.verified} verified</Badge> : null}
                                {e.pending ? <Badge tone="warn">{e.pending} pending</Badge> : null}
                                {e.expired ? <Badge tone="danger">{e.expired} expired</Badge> : null}
                                {e.rejected ? <Badge>{e.rejected} rejected</Badge> : null}
                                {e.revoked ? <Badge>{e.revoked} revoked</Badge> : null}
                              </>
                            ) : (
                              <span className="text-fg-3">none yet</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="lg:col-span-2">
                  <h3 className="mb-2 text-[12px] font-medium text-fg-2">MADP checks on active members</h3>
                  <Table head={['Check', 'Members', 'Share', '']}>
                    {s.checks.map((c) => {
                      const n = p.checks[c.key] ?? 0;
                      return (
                        <tr key={c.key}>
                          <td className="px-5 py-1.5">
                            {c.label}
                            <span className="block text-[11px] text-fg-3">{c.why}</span>
                          </td>
                          <td className="px-5 py-1.5 font-mono">{fmt(n)}</td>
                          <td className="px-5 py-1.5">{pct(n, p.members)}</td>
                          <td className="px-5 py-1.5 text-right">
                            {canDrill && n > 0 ? (
                              <Link className="text-[12px] text-accent underline" href={`/verification?panel=${p.panel}&check=${c.key}#members`}>
                                See members
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </Table>
                </div>
              </div>
            </Card>
          );
        })}

        {drill ? (
          <Card>
            <div id="members" />
            <CardHeader
              title={`${PANELS[drill.panel].shortName}: ${drill.label}`}
              hint={`${drill.why} Person ids and masked panel ids only; open a profile to see more, which is audited.`}
            />
            {drill.items.length === 0 ? (
              <EmptyState title="Nobody fails this check" />
            ) : (
              <Table head={['Person', 'Panel id', 'Quality score', 'E-mail (panel)', 'Country', ...(drill.items.some((i) => i.timezone !== undefined) ? ['Time zone'] : [])]}>
                {drill.items.map((i) => (
                  <tr key={i.personId}>
                    <td className="px-5 py-1.5 font-mono text-[12px]">
                      <Link className="underline" href={`/panellists/${i.personId}`}>
                        {i.personId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-5 py-1.5 font-mono text-[12px]">{i.sourceMember}</td>
                    <td className="px-5 py-1.5">{fmt(i.qualityScore)}</td>
                    <td className="px-5 py-1.5">{i.emailVerification}</td>
                    <td className="px-5 py-1.5">{i.country ?? '—'}</td>
                    {i.timezone !== undefined ? <td className="px-5 py-1.5 font-mono text-[12px]">{i.timezone ?? '—'}</td> : null}
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        ) : null}

        {canReview ? <NewEvidence /> : null}

        <Card>
          <CardHeader title="Verification evidence" hint="Pending first. Whoever recorded the evidence cannot decide it." />
          {ev.items.length === 0 ? (
            <EmptyState title="No evidence recorded yet">Record a licence, identity, age or employment check above.</EmptyState>
          ) : (
            <Table head={['Claim', 'Panel', 'Status', 'Recorded', 'Expires', '']}>
              {ev.items.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-5 py-2">
                    <span className="font-medium">{CLAIM_LABEL[e.claim] ?? e.claim}</span>
                    <span className="block text-[12px] text-fg-3">
                      {human(e.method)} · {e.reference} · person{' '}
                      <Link className="font-mono underline" href={`/panellists/${e.personId}`}>
                        {e.personId.slice(0, 8)}
                      </Link>
                    </span>
                    {e.decisionNote ? <span className="block text-[12px] text-fg-3">Note: {e.decisionNote}</span> : null}
                  </td>
                  <td className="px-5 py-2">
                    <PanelChip panel={e.panel} />
                  </td>
                  <td className="px-5 py-2">
                    <Badge tone={e.expired ? 'danger' : e.status === 'verified' ? 'teal' : e.status === 'pending' ? 'warn' : 'neutral'}>
                      {e.expired ? 'expired' : e.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-2 text-[12px]">{fmtDate(e.createdAt)}</td>
                  <td className="px-5 py-2 text-[12px]">{e.expiresOn ?? '—'}</td>
                  <td className="px-5 py-2 text-right">
                    {canReview ? <EvidenceSteps id={e.id} status={e.status} mine={e.recordedBy === me.id} /> : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
