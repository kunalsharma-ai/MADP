'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardList, Hourglass, PartyPopper, Rocket, Sparkles, UserRoundPen } from 'lucide-react';
import type { WelcomeJourneyPanel } from '@madp/contracts';
import { startWelcomeJourneyAction } from '@/app/actions';
import { BrandLogo } from '@/components/brand-logo';
import { usePanels } from '@/components/panels-context';
import { TopicInfo } from '@/components/screen-info';
import { panelName, panelShort } from '@/lib/panel-names';
import { PANEL_TONES } from '@/lib/panel-tones';
import { cn } from '@/lib/cn';

const STEP_ICON = { welcome: PartyPopper, profile_recovery: UserRoundPen, survey_reminder: ClipboardList } as const;
const STEP_TINT = { welcome: '#6366f1', profile_recovery: '#ec4899', survey_reminder: '#14b8a6' } as const;

function state(p: WelcomeJourneyPanel): { label: string; tone: string; icon: typeof Rocket } {
  if (!p.automation) return { label: 'Not set up', tone: '#94a3b8', icon: Sparkles };
  if (p.automation.status === 'active') return { label: 'Approved and on (dry runs only)', tone: '#16a34a', icon: CheckCircle2 };
  if (p.automation.versionStatus === 'in_review') return { label: 'Waiting for a second admin', tone: '#d97706', icon: Hourglass };
  return { label: p.automation.status.replace('_', ' '), tone: '#64748b', icon: Hourglass };
}

/**
 * The ready-made welcome journey, one card per panel: day 1 welcome, day 3 "finish your profile" (only while the
 * profile is incomplete), day 7 "take your first survey". One click sets it up; a second admin approves it.
 */
export function WelcomeJourney({ panels: list, canManage }: { panels: WelcomeJourneyPanel[]; canManage: boolean }) {
  const panels = usePanels();
  const router = useRouter();
  const [pending, start] = useTransition();
  const setUp = (panel: string) =>
    start(async () => {
      const r = await startWelcomeJourneyAction(panel);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Welcome journey set up for ${panelShort(panel, panels)}. A second admin approves it next.`);
      router.refresh();
    });

  return (
    <section aria-label="Welcome journey" className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
      <div className="flex flex-wrap items-center gap-2 bg-gradient-to-r from-[#6366f1] via-[#a855f7] to-[#ec4899] px-5 py-3 text-white">
        <Rocket className="size-4" aria-hidden />
        <h2 className="text-[15px] font-bold">Welcome journey for new members</h2>
        <TopicInfo
          title="Welcome journey"
          help={{
            why: 'New members who hear from you in their first week stay longer. This gives every T2O, MFR and MHO member the same warm start.',
            where: 'An ordinary New registration automation on each panel, built from that panel’s approved templates. Its runs show who it would reach; nothing is sent while sending is off.',
            how: [
              'Approve three templates for the panel on Messages: a welcome, a profile recovery and a survey reminder.',
              'Press Set up. The journey goes to a second admin, who approves it before it turns on.',
              'Day 3 goes only to members whose profile is still incomplete. Teens and members without consent are skipped by the usual checks.',
            ],
          }}
        />
        <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">Approval before anything is sent</span>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {list.map((p) => {
          const s = state(p);
          const [a, b] = PANEL_TONES[p.panel] ?? ['#a78bfa', '#7c3aed'];
          const missing = p.steps.filter((x) => !x.template);
          return (
            <div key={p.panel} className="relative overflow-hidden rounded-2xl border border-border p-4">
              <div className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full opacity-20 blur-2xl" style={{ background: b }} aria-hidden />
              <div className="relative flex items-center gap-3">
                <BrandLogo panel={p.panel} label={panelShort(p.panel, panels)} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-fg">{panelName(p.panel, panels)}</p>
                  <p className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: s.tone }}>
                    <s.icon className="size-3" aria-hidden /> {s.label}
                  </p>
                </div>
              </div>
              <ol className="relative mt-3 grid gap-2">
                <span className="absolute bottom-3 left-[15px] top-3 w-0.5 rounded-full" style={{ backgroundImage: `linear-gradient(${a}, ${b})` }} aria-hidden />
                {p.steps.map((x) => {
                  const Icon = STEP_ICON[x.kind as keyof typeof STEP_ICON] ?? Sparkles;
                  const tint = STEP_TINT[x.kind as keyof typeof STEP_TINT] ?? '#64748b';
                  return (
                    <li key={x.atDays} className="relative flex items-start gap-2.5">
                      <span className="relative grid size-8 shrink-0 place-items-center rounded-xl text-white shadow-md" style={{ background: tint }}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 text-[12px]">
                        <p className="font-semibold text-fg">
                          Day {x.atDays}: {x.label}
                        </p>
                        <p className={cn('truncate', x.template ? 'text-fg-3' : 'text-[#d97706]')}>
                          {x.template ? x.template.name : `Needs an approved ${x.kind.replace('_', ' ')} template`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!p.automation && canManage ? (
                missing.length ? (
                  <Link href="/communications" className="relative mt-3 inline-flex text-[12px] font-semibold text-accent hover:underline">
                    Approve {missing.length === 1 ? 'the missing template' : `${missing.length} templates`} on Messages
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setUp(p.panel)}
                    className="relative mt-3 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:-translate-y-px disabled:opacity-60"
                    style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }}
                  >
                    <Rocket className="size-3.5" aria-hidden /> Set up for {panelShort(p.panel, panels)}
                  </button>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
