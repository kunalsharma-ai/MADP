'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Hourglass, Mail, MailPlus, Moon, RefreshCcw, Sparkles, Users } from 'lucide-react';
import type { WinBackPanel } from '@madp/contracts';
import { draftWinBackAction, startWinBackAction } from '@/app/actions';
import { BrandLogo } from '@/components/brand-logo';
import { usePanels } from '@/components/panels-context';
import { TopicInfo } from '@/components/screen-info';
import { panelName, panelShort } from '@/lib/panel-names';
import { PANEL_TONES } from '@/lib/panel-tones';
import { cn } from '@/lib/cn';

const STEP_TINT = { 30: '#f59e0b', 60: '#f97316', 90: '#ef4444' } as Record<number, string>;
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft: edit and send for review',
  in_review: 'Waiting for a second admin',
  approved: 'Approved',
  rejected: 'Sent back: edit and try again',
  retired: 'Retired',
};

function state(p: WinBackPanel): { label: string; tone: string; icon: typeof Sparkles } {
  if (!p.automation) return { label: 'Not set up', tone: '#94a3b8', icon: Sparkles };
  if (p.automation.status === 'active') return { label: 'Approved and on (dry runs only)', tone: '#16a34a', icon: CheckCircle2 };
  if (p.automation.versionStatus === 'in_review') return { label: 'Waiting for a second admin', tone: '#d97706', icon: Hourglass };
  return { label: p.automation.status.replace('_', ' '), tone: '#64748b', icon: Hourglass };
}

const fmtN = (n: number) => new Intl.NumberFormat('en-IN').format(n);

/**
 * Win-back for members who went quiet, one card per panel: how many members have had no activity for 30, 60 and 90
 * days (each opens that list on Members), one click to draft the three mailers, and one click to set up the journey
 * once a second admin approved them. Nothing is sent while sending is off.
 */
export function WinBack({ panels: list, canManage }: { panels: WinBackPanel[]; canManage: boolean }) {
  const panels = usePanels();
  const router = useRouter();
  const [pending, start] = useTransition();
  const draft = (panel: string) =>
    start(async () => {
      const r = await draftWinBackAction(panel);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        r.data.created.length
          ? `${r.data.created.length} win-back mailer draft${r.data.created.length === 1 ? '' : 's'} made for ${panelShort(panel, panels)}. Edit them on Messages and send for review.`
          : 'Those drafts already exist.',
      );
      router.refresh();
    });
  const setUp = (panel: string) =>
    start(async () => {
      const r = await startWinBackAction(panel);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Win-back journey set up for ${panelShort(panel, panels)}. A second admin approves it next.`);
      router.refresh();
    });

  return (
    <section aria-label="Win-back journey" className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
      <div className="flex flex-wrap items-center gap-2 bg-gradient-to-r from-[#f59e0b] via-[#f97316] to-[#ef4444] px-5 py-3 text-white">
        <RefreshCcw className="size-4" aria-hidden />
        <h2 className="text-[15px] font-bold">Win back quiet members</h2>
        <TopicInfo
          title="Win-back journey"
          help={{
            why: 'Members who stop taking surveys rarely come back on their own. A friendly reminder at 30, 60 and 90 days brings many of them back, on T2O, MFR and MHO alike.',
            where: 'The counts come from each panel’s own last activity (teens left out). The journey is an ordinary Inactivity automation built from three re-engagement templates on that panel.',
            how: [
              'Press Draft mailers. Three ready e-mails are made as drafts: “We miss you”, “New surveys are waiting” and “Last reminder”.',
              'Edit them on Messages if you like, send each for review, and a second admin approves them.',
              'Press Set up. The journey goes to a second admin, who approves it before it turns on. Nothing is sent while sending is off.',
            ],
          }}
        />
        <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">Approval before anything is sent</span>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {list.map((p) => {
          const s = state(p);
          const [a, b] = PANEL_TONES[p.panel] ?? ['#fbbf24', '#ea580c'];
          const notDrafted = p.steps.filter((x) => !x.template).length;
          const notApproved = p.steps.filter((x) => !x.approved).length;
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

              <div className="relative mt-3 grid grid-cols-3 gap-2">
                {p.steps.map((x) => {
                  const k = String(x.atDays) as '30' | '60' | '90';
                  const n = p.inactive?.[k];
                  const tint = STEP_TINT[x.atDays] ?? '#64748b';
                  return (
                    <Link
                      key={x.atDays}
                      href={`/members?inactiveSince=${p.since[k]}`}
                      title={`Members on ${panelShort(p.panel, panels)} with no activity since ${p.since[k]}. Pick this brand at the top to open the list.`}
                      className="group rounded-xl border border-border bg-surface-2/60 px-2 py-2 text-center transition hover:-translate-y-px hover:shadow-sm"
                    >
                      <span className="mx-auto mb-1 grid size-7 place-items-center rounded-lg text-white shadow" style={{ background: tint }}>
                        <Moon className="size-3.5" aria-hidden />
                      </span>
                      <span className="block text-[18px] font-bold leading-6 text-fg tabular-nums">{n === undefined ? '–' : fmtN(n)}</span>
                      <span className="block text-[10.5px] font-medium text-fg-3">{x.atDays}+ days quiet</span>
                    </Link>
                  );
                })}
              </div>
              {p.inactive === null ? (
                <p className="relative mt-1.5 inline-flex items-center gap-1 text-[11px] text-fg-3">
                  <Users className="size-3" aria-hidden /> Counts need member access on this panel, or the panel did not answer.
                </p>
              ) : null}

              <ol className="relative mt-3 grid gap-1.5">
                {p.steps.map((x) => (
                  <li key={x.atDays} className="flex items-start gap-2 text-[12px]">
                    <Mail className="mt-0.5 size-3.5 shrink-0" style={{ color: STEP_TINT[x.atDays] }} aria-hidden />
                    <div className="min-w-0">
                      <p className="font-semibold text-fg">
                        Day {x.atDays}: {x.label}
                      </p>
                      <p className={cn('truncate', x.approved ? 'text-[#16a34a]' : x.template ? 'text-[#d97706]' : 'text-fg-3')}>
                        {x.approved ? 'Approved' : x.template ? (STATUS_LABEL[x.latestStatus ?? ''] ?? x.latestStatus) : 'No mailer yet'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              {canManage && !p.automation ? (
                <div className="relative mt-3 flex flex-wrap gap-2">
                  {notDrafted ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => draft(p.panel)}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:-translate-y-px disabled:opacity-60"
                      style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }}
                    >
                      <MailPlus className="size-3.5" aria-hidden /> Draft {notDrafted === 3 ? 'the 3 mailers' : `${notDrafted} missing`}
                    </button>
                  ) : notApproved ? (
                    <Link href={`/communications?panel=${p.panel}`} className="inline-flex text-[12px] font-semibold text-accent hover:underline">
                      Review and approve {notApproved === 1 ? 'the last mailer' : `${notApproved} mailers`} on Messages
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setUp(p.panel)}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:-translate-y-px disabled:opacity-60"
                      style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }}
                    >
                      <RefreshCcw className="size-3.5" aria-hidden /> Set up for {panelShort(p.panel, panels)}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
