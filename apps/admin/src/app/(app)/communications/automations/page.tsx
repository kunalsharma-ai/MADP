import type { Metadata } from 'next';
import { PANEL_CODES, PANELS, type AutomationStep, type DataMode, type PanelCode } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, fmt, fmtDate } from '@/components/ui';
import {
  AutomationButtons,
  AutomationVersionButtons,
  CelebrationButtons,
  NewAutomation,
  NewCelebration,
  type TemplateOption,
} from './automation-forms';

export const metadata: Metadata = { title: 'Lifecycle automations' };

interface Celebration {
  id: string;
  panel: PanelCode;
  name: string;
  observance: 'civic' | 'religious_cultural';
  onDate: string;
  countries: string[];
  status: string;
}
interface Version {
  id: string;
  version: number;
  status: string;
  config: { completionThreshold?: number; requiredQuestionIds?: string[]; minDaysBetween?: number; celebrationId?: string };
  steps: AutomationStep[];
  restoredFrom: string | null;
  reviewNote: string | null;
}
interface Run {
  startedAt: string;
  error: string | null;
  counts: {
    due: number;
    planned: number;
    suppressed: number;
    notDue: number;
    delayedByQuietHours: number;
    reasons: Record<string, number>;
    stepsSkipped: number[];
    consentsRequired: string[];
  } | null;
}
interface Automation {
  id: string;
  panel: PanelCode;
  name: string;
  trigger: string;
  status: string;
  currentVersionId: string | null;
  versions: Version[];
  lastRun: Run | null;
}

const REASON_LABELS: Record<string, string> = {
  membership_not_active: 'Membership not active',
  minor_excluded: 'Minor (excluded)',
  no_consent: 'No consent on record',
  no_email: 'No usable e-mail',
  opted_out: 'Opted out',
  bounced_or_complained: 'Bounced or complained',
  already_sent: 'Step already sent',
  frequency_cap_week: 'Weekly cap reached',
  frequency_cap_month: 'Monthly cap reached',
  too_soon: 'Too soon after the last message',
  no_birth_date: 'No date of birth',
  no_greeting_preference: 'Has not chosen this greeting',
};
const TONE: Record<string, 'teal' | 'warn' | 'danger' | 'neutral'> = {
  approved: 'teal',
  active: 'teal',
  in_review: 'warn',
  pending: 'warn',
  paused: 'warn',
  rejected: 'danger',
};
const STOP: Record<string, string> = {
  inactivity: 'Stops when the member is active again or opts out',
  incomplete_profile: 'Stops when the profile is complete',
  registration: 'Each step only in the week it falls due',
  birthday: 'Once a year',
  festival: 'Once per calendar date',
};

/** The builder's stages, filled in from one version, so a reviewer can read the rule left to right. */
function Pipeline({ a, v, templates, celebrations }: { a: Automation; v: Version; templates: Map<string, string>; celebrations: Map<string, string> }) {
  const stages: [string, string][] = [
    ['Trigger', a.trigger.replace('_', ' ')],
    ['Segment', PANELS[a.panel].shortName],
    [
      'Conditions',
      a.trigger === 'festival'
        ? (celebrations.get(v.config.celebrationId ?? '') ?? 'calendar date')
        : a.trigger === 'incomplete_profile' || a.trigger === 'registration'
          ? `below ${Math.round((v.config.completionThreshold ?? 0.8) * 100)}% complete${v.config.requiredQuestionIds?.length ? `, ${v.config.requiredQuestionIds.length} required` : ''}`
          : '—',
    ],
    ['Gate', 'consent, minors, caps, quiet hours'],
    ['Steps', v.steps.map((s) => `day ${s.atDays}: ${templates.get(s.templateVersionId) ?? 'retired template'}`).join(' · ')],
    ['Channel', 'e-mail'],
    ['Spacing', `${v.config.minDaysBetween ?? 7} days`],
    ['Stop', STOP[a.trigger] ?? ''],
  ];
  return (
    <ol className="mt-2 flex flex-wrap items-stretch gap-1 text-[11px]">
      {stages.map(([k, val], i) => (
        <li key={k} className="flex items-center gap-1">
          <span className="rounded-md bg-surface-2 px-2 py-1">
            <span className="block text-fg-3">{k}</span>
            <span className="text-fg">{val}</span>
          </span>
          {i < stages.length - 1 ? <span aria-hidden className="text-fg-3">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const sp = await searchParams;
  const panel = (PANEL_CODES as readonly string[]).includes(sp.panel ?? '') ? (sp.panel as PanelCode) : undefined;
  const qs = panel ? `?panel=${panel}` : '';
  const [cal, auto, tpl] = await Promise.all([
    api<{ items: Celebration[]; rule: string }>(`/communications/calendar${qs}`),
    api<{ dataMode: DataMode; qualifyingActivity: string[]; items: Automation[] }>(`/communications/automations${qs}`),
    api<{ items: { id: string; panel: PanelCode; name: string; kind: string; versions: { id: string; version: number; status: string }[] }[] }>(
      '/communications/templates',
    ),
  ]);
  const options: TemplateOption[] = tpl.items.flatMap((t) =>
    t.versions.filter((v) => v.status === 'approved').map((v) => ({ id: v.id, panel: t.panel, kind: t.kind, label: `${t.name} v${v.version}` })),
  );
  const templateNames = new Map(
    tpl.items.flatMap((t) => t.versions.filter((v) => v.status === 'approved').map((v) => [v.id, `${t.name} v${v.version}`] as const)),
  );
  const approvedDates = cal.items.filter((c) => c.status === 'approved');
  const celebrationNames = new Map(cal.items.map((c) => [c.id, `${c.name} (${c.onDate})`]));
  return (
    <>
      <PageHeader
        eyebrow="Engagement"
        title="Lifecycle automations"
        description="Rules that follow each member's journey on one panel: win-back after inactivity, profile completion, onboarding, birthdays and reviewed calendar greetings. A second person approves every version. Runs are dry runs; nothing is sent."
        actions={
          <>
            <DataModeBadge mode={auto.dataMode} />
            <Badge tone="warn">Sending off</Badge>
          </>
        }
      />
      <DemoBanner mode={auto.dataMode} />
      <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
        Activity that counts for inactivity: {auto.qualifyingActivity.map((a) => a.replaceAll('_', ' ')).join(', ')}. The panels do
        not export logins, so those cannot count until they do.
      </p>
      <div className="grid gap-4">
        <Card>
          <CardHeader title="Automations" hint="Each version is reviewed; a rollback restores an old version as a new draft" action={<NewAutomation templates={options} celebrations={approvedDates.map((c) => ({ id: c.id, panel: c.panel, label: `${c.name} (${c.onDate})` }))} />} />
          {auto.items.length === 0 ? (
            <EmptyState title="No automations yet">An automation needs an approved template of the right kind.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {auto.items.map((a) => {
                const current = a.versions.find((v) => v.id === a.currentVersionId) ?? a.versions[0];
                const c = a.lastRun?.counts;
                return (
                  <li key={a.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <PanelChip panel={a.panel} />
                      <span className="font-medium">{a.name}</span>
                      <Badge>{a.trigger.replace('_', ' ')}</Badge>
                      <Badge tone={TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                      <span className="ml-auto">
                        <AutomationButtons id={a.id} status={a.status} />
                      </span>
                    </div>
                    {current ? <Pipeline a={a} v={current} templates={templateNames} celebrations={celebrationNames} /> : null}
                    <ul className="mt-2 space-y-1 text-[12px]">
                      {a.versions.map((v) => (
                        <li key={v.id} className="flex flex-wrap items-center gap-2">
                          <span className="w-8 text-fg-3">v{v.version}</span>
                          <span className="text-fg-2">{v.steps.map((s) => `day ${s.atDays}`).join(', ')}</span>
                          {v.restoredFrom ? <span className="text-fg-3">restored</span> : null}
                          <Badge tone={TONE[v.status] ?? 'neutral'}>{v.status.replace('_', ' ')}</Badge>
                          <AutomationVersionButtons id={v.id} status={v.status} />
                        </li>
                      ))}
                    </ul>
                    {a.lastRun ? (
                      <div className="mt-2 text-[12px] text-fg-2">
                        {a.lastRun.error ? (
                          <p className="text-danger">Last run {fmtDate(a.lastRun.startedAt)} failed: {a.lastRun.error}. Run it again to retry.</p>
                        ) : c ? (
                          <>
                            <p>
                              Last dry run {fmtDate(a.lastRun.startedAt)}: {fmt(c.planned)} of {fmt(c.due)} due would get a message
                              {c.delayedByQuietHours ? `, ${fmt(c.delayedByQuietHours)} after quiet hours` : ''}; {fmt(c.notDue)} not due.
                              {c.consentsRequired.length ? ` Needs consent: ${c.consentsRequired.join(', ')}.` : ''}
                              {c.stepsSkipped.length ? ` Skipped steps with a retired template: day ${c.stepsSkipped.join(', ')}.` : ''}
                            </p>
                            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-fg-3">
                              {Object.entries(c.reasons).map(([r, n]) => (
                                <li key={r}>
                                  {REASON_LABELS[r] ?? r}: {fmt(n)}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Celebration calendar" hint={cal.rule} action={<NewCelebration />} />
          {cal.items.length === 0 ? (
            <EmptyState title="No dates yet">Add a date for a panel; a second person reviews it.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {cal.items.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
                  <PanelChip panel={c.panel} />
                  <span className="w-24 font-mono text-[12px] text-fg-2">{c.onDate}</span>
                  <span className="font-medium">{c.name}</span>
                  <Badge>{c.observance === 'civic' ? 'civic' : 'religious or cultural'}</Badge>
                  <span className="text-fg-3">{c.countries.map((x) => x.toUpperCase()).join(', ')}</span>
                  <Badge tone={TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                  <span className="ml-auto">
                    <CelebrationButtons id={c.id} status={c.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
