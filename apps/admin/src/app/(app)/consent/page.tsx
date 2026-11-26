import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { type DataMode, type PanelCode, type SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { PANEL_TONES } from '@/lib/panel-tones';
import {
  Badge,
  Card,
  CardHeader,
  DataModeBadge,
  DemoBanner,
  EmptyState,
  PageHeader,
  PanelChip,
  Table,
  fmt,
  fmtDate,
} from '@/components/ui';
import { PreferenceForm } from './consent-forms';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Consent & preferences' };

interface PanelConsent {
  panel: PanelCode;
  purposes: Record<string, Record<string, number>>;
  contactable: {
    memberships: number;
    active: number;
    adults: number;
    termsAccepted: number;
    usableAddress: number;
    notOptedOut: number;
    reachable: number;
  };
  madpOptOuts: Record<string, number>;
  gaps: string[];
}
interface ConsentEvent {
  id: number;
  personId: string;
  panel: PanelCode;
  purpose: string;
  previousStatus: string | null;
  status: string;
  source: string | null;
  at: string;
}
interface Preference {
  id: string;
  personId: string;
  panel: PanelCode;
  channel: string;
  status: string;
  source: string;
  reason: string;
  recordedAt: string;
}

const FUNNEL: [keyof PanelConsent['contactable'], string][] = [
  ['memberships', 'Panel accounts'],
  ['active', 'Active'],
  ['adults', 'Adults'],
  ['termsAccepted', 'Terms accepted'],
  ['usableAddress', 'Usable e-mail'],
  ['notOptedOut', 'Not opted out'],
  ['reachable', 'Reachable (no bounce)'],
];

const PURPOSES: Record<string, string> = {
  email_marketing: 'Marketing e-mails',
  push_notifications: 'Push notifications',
  terms: 'Terms of use',
  guardian_consent: 'Parent or guardian consent',
  sms_marketing: 'Marketing SMS',
};
const purposeLabel = (p: string) => PURPOSES[p] ?? p.replaceAll('_', ' ');

export default async function ConsentPage() {
  const panelList = await getPanels();
  const [me, s, events, prefs] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<{ dataMode: DataMode; note: string; panels: PanelConsent[] }>('/consent/summary'),
    api<ConsentEvent[]>('/consent/events?limit=30'),
    api<Preference[]>('/consent/preferences?limit=30'),
  ]);
  const canManage = me.permissions.includes('consent.manage');
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Consent & preferences"
        description="Consent as each panel reports it, kept with its full history as evidence, and the channel opt-outs members asked MADP for. Panels are never added together. MADP never grants consent."
        actions={<DataModeBadge mode={s.dataMode} />}
      />
      <DemoBanner mode={s.dataMode} />
      <p className="mb-4 rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-fg-2">{s.note}</p>
      <div className="grid gap-4 xl:grid-cols-3">
        {s.panels.map((p) => (
          <Card key={p.panel}>
            <CardHeader
              title={panelName(p.panel, panelList)}
              hint="Who MADP may e-mail today, step by step"
            />
            <ol className="space-y-2 px-5 py-4 text-[13px]">
              {FUNNEL.map(([k, label], i) => {
                const top = Math.max(1, p.contactable.memberships);
                const share = p.contactable[k] / top;
                return (
                  <li key={k}>
                    <div className="flex justify-between">
                      <span className="text-fg-2">{label}</span>
                      <span className="font-mono">
                        {fmt(p.contactable[k])}
                        <span className="ml-1.5 text-[11px] text-fg-3">{Math.round(share * 100)}%</span>
                      </span>
                    </div>
                    <span className="mt-1 block h-2 rounded-full bg-surface-2">
                      <span
                        className="grow-x block h-2 rounded-full"
                        style={{
                          width: `${share * 100}%`,
                          background: `linear-gradient(90deg, ${PANEL_TONES[p.panel]?.[0] ?? '#818cf8'}, ${PANEL_TONES[p.panel]?.[1] ?? '#6366f1'})`,
                          animationDelay: `${i * 70}ms`,
                        }}
                      />
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="border-t border-border px-5 py-3 text-[12px] text-fg-2">
              {Object.entries(p.purposes).map(([purpose, st]) => (
                <div key={purpose}>
                  <span className="font-medium text-fg">{purposeLabel(purpose)}</span>:{' '}
                  {Object.entries(st)
                    .map(([k, v]) => `${k} ${fmt(v)}`)
                    .join(', ')}
                </div>
              ))}
              <div className="mt-1">
                MADP opt-outs:{' '}
                {Object.entries(p.madpOptOuts)
                  .map(([k, v]) => `${k} ${fmt(v)}`)
                  .join(', ') || 'none'}
              </div>
            </div>
            {p.gaps.length ? (
              <ul className="border-t border-border px-5 py-3 text-[12px] text-warn">
                {p.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
      </div>
      {canManage ? <PreferenceForm panels={s.panels.map((p) => p.panel)} /> : null}
      <div className="mt-4 grid gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent consent changes"
            hint="Append-only history, written on every change the panel reports"
            action={
              <DownloadMenu
                screen="consent"
                title="Recent consent changes"
                columns={[
                  { key: 'at', label: 'When', type: 'date' },
                  { key: 'panel', label: 'Panel' },
                  { key: 'purpose', label: 'Purpose' },
                  { key: 'before', label: 'Was' },
                  { key: 'status', label: 'Now' },
                  { key: 'source', label: 'Source' },
                  { key: 'person', label: 'Person id' },
                ]}
                rows={events.map((e) => ({
                  at: e.at,
                  panel: e.panel.toUpperCase(),
                  purpose: purposeLabel(e.purpose),
                  before: e.previousStatus,
                  status: e.status,
                  source: e.source,
                  person: e.personId,
                }))}
              />
            }
          />
          {events.length === 0 ? (
            <EmptyState title="No consent recorded yet" />
          ) : (
            <Table head={['When', 'Panel', 'Purpose', 'Change', 'Person']}>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-5 py-2 text-fg-3">{fmtDate(e.at)}</td>
                  <td className="px-5 py-2">
                    <PanelChip panel={e.panel} />
                  </td>
                  <td className="px-5 py-2 text-[12.5px]">{purposeLabel(e.purpose)}</td>
                  <td className="px-5 py-2">
                    {e.previousStatus ? `${e.previousStatus} → ` : ''}
                    <Badge tone={e.status === 'granted' ? 'teal' : 'warn'}>{e.status}</Badge>
                  </td>
                  <td className="px-5 py-2 font-mono text-[11px] text-fg-3">
                    <a href={`/panellists/${e.personId}`}>{e.personId.slice(0, 8)}</a>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Channel opt-outs recorded in MADP"
            hint="Each line is kept; lifting an opt-out adds a new line"
            action={
              <DownloadMenu
                screen="consent"
                title="Channel opt-outs"
                columns={[
                  { key: 'at', label: 'When', type: 'date' },
                  { key: 'panel', label: 'Panel' },
                  { key: 'channel', label: 'Channel' },
                  { key: 'status', label: 'Status' },
                  { key: 'source', label: 'Source' },
                  { key: 'reason', label: 'Reason' },
                  { key: 'person', label: 'Person id' },
                ]}
                rows={prefs.map((r) => ({
                  at: r.recordedAt,
                  panel: r.panel.toUpperCase(),
                  channel: r.channel,
                  status: r.status,
                  source: r.source.replace('_', ' '),
                  reason: r.reason,
                  person: r.personId,
                }))}
              />
            }
          />
          {prefs.length === 0 ? (
            <EmptyState title="No opt-outs recorded" />
          ) : (
            <Table head={['When', 'Panel', 'Channel', 'Status', 'Source']}>
              {prefs.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2 text-fg-3">{fmtDate(r.recordedAt)}</td>
                  <td className="px-5 py-2">
                    <PanelChip panel={r.panel} />
                  </td>
                  <td className="px-5 py-2">{r.channel}</td>
                  <td className="px-5 py-2">
                    <Badge tone={r.status === 'opted_out' ? 'warn' : 'teal'}>{r.status}</Badge>
                  </td>
                  <td className="px-5 py-2 text-[12px] text-fg-2">
                    {r.source.replace('_', ' ')}: {r.reason}
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
