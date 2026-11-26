'use client';
import { panelName, panelShort } from '@/lib/panel-names';
import { usePanels } from '@/components/panels-context';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AutomationTrigger, TRIGGER_KINDS } from '@madp/contracts';
import {
  automationAction,
  automationVersionAction,
  createAutomationAction,
  createCelebrationAction,
  reviewCelebrationAction,
} from '../../../actions';
import { btn } from '@/components/ui';

const field = 'rounded-md border border-border bg-surface px-2 py-1 text-[12px]';

function useAct() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      try {
        const r = await fn();
        toast.success(typeof r === 'string' ? r : ok);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, act };
}

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  inactivity: 'Inactive member (days idle)',
  incomplete_profile: 'Incomplete profile (days since joining)',
  registration: 'New registration (days since joining)',
  birthday: 'Birthday',
  festival: 'Calendar greeting',
};

export function NewCelebration() {
  const panelList = usePanels();
  const [open, setOpen] = useState(false);
  const { pending, act } = useAct();
  if (!open)
    return (
      <button className={btn.secondary} onClick={() => setOpen(true)}>
        Add date
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      action={(f) =>
        act(
          () =>
            createCelebrationAction(
              String(f.get('panel')),
              String(f.get('name')),
              String(f.get('observance')),
              String(f.get('onDate')),
              String(f.get('countries'))
                .split(',')
                .map((c) => c.trim().toLowerCase())
                .filter(Boolean),
            ),
          'Added for review',
        )
      }
    >
      <select name="panel" className={field} aria-label="Panel">
        {panelList.map((x) => x.code).map((p) => (
          <option key={p} value={p}>
            {panelShort(p, panelList)}
          </option>
        ))}
      </select>
      <input name="name" required minLength={2} placeholder="Name" className={field} aria-label="Name" />
      <input name="onDate" type="date" required className={field} aria-label="Date" />
      <input name="countries" required placeholder="in, us" className={field} aria-label="Countries (ISO codes)" />
      <select name="observance" className={field} aria-label="Kind of greeting">
        <option value="civic">Civic (everyone in these countries)</option>
        <option value="religious_cultural">Religious or cultural (only members who chose it)</option>
      </select>
      <button className={btn.primary} disabled={pending}>
        Add
      </button>
    </form>
  );
}

export function CelebrationButtons({ id, status }: { id: string; status: string }) {
  const { pending, act } = useAct();
  if (status !== 'pending') return null;
  return (
    <span className="flex gap-1">
      <button className={btn.primary} disabled={pending} onClick={() => act(() => reviewCelebrationAction(id, 'approve'), 'Approved')}>
        Approve
      </button>
      <button className={btn.ghost} disabled={pending} onClick={() => act(() => reviewCelebrationAction(id, 'reject'), 'Rejected')}>
        Reject
      </button>
    </span>
  );
}

export interface TemplateOption {
  id: string;
  panel: string;
  kind: string;
  label: string;
}

export function NewAutomation({
  templates,
  celebrations,
}: {
  templates: TemplateOption[];
  celebrations: { id: string; panel: string; label: string }[];
}) {
  const panelList = usePanels();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<string>(panelList.map((x) => x.code)[0]);
  const [trigger, setTrigger] = useState<AutomationTrigger>('inactivity');
  const { pending, act } = useAct();
  if (!open)
    return (
      <button className={btn.secondary} onClick={() => setOpen(true)}>
        New automation
      </button>
    );
  const kinds = TRIGGER_KINDS[trigger] as string[];
  const usable = templates.filter((t) => t.panel === panel && kinds.includes(t.kind));
  const dated = trigger === 'birthday' || trigger === 'festival';
  return (
    <form
      className="grid gap-2 px-5 pb-4 text-[12px] sm:grid-cols-2"
      action={(f) => {
        const days = dated
          ? [0]
          : String(f.get('days'))
              .split(',')
              .map((d) => Number(d.trim()))
              .filter((d) => Number.isInteger(d) && d >= 0);
        const required = String(f.get('required') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        act(
          () =>
            createAutomationAction({
              panel,
              trigger,
              name: String(f.get('name')),
              config: {
                minDaysBetween: Number(f.get('spacing') || 7),
                ...(trigger === 'incomplete_profile' || trigger === 'registration'
                  ? { completionThreshold: Number(f.get('threshold') || 80) / 100 }
                  : {}),
                ...(trigger === 'incomplete_profile' ? { requiredQuestionIds: required } : {}),
                ...(trigger === 'festival' ? { celebrationId: String(f.get('celebration')) } : {}),
              },
              steps: days.map((atDays) => ({
                atDays,
                templateVersionId: String(f.get('template')),
                onlyIfIncomplete: trigger === 'registration' && f.get('onlyIncomplete') === 'on' && atDays > 0,
              })),
            }),
          'Automation drafted',
        );
      }}
    >
      <label className="flex flex-col gap-1">
        1. Panel
        <select className={field} value={panel} onChange={(e) => setPanel(e.target.value)}>
          {panelList.map((x) => x.code).map((p) => (
            <option key={p} value={p}>
              {panelName(p, panelList)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        2. Trigger
        <select className={field} value={trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}>
          {AutomationTrigger.options.map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Name
        <input name="name" required minLength={2} className={field} />
      </label>
      {!dated ? (
        <label className="flex flex-col gap-1">
          3. Steps (days, comma separated)
          <input name="days" required defaultValue={trigger === 'inactivity' ? '15, 30, 60, 90' : trigger === 'registration' ? '0, 3' : '3, 10'} className={field} />
        </label>
      ) : null}
      {trigger === 'incomplete_profile' || trigger === 'registration' ? (
        <label className="flex flex-col gap-1">
          Incomplete below (% of questions)
          <input name="threshold" type="number" min={5} max={100} defaultValue={80} className={field} />
        </label>
      ) : null}
      {trigger === 'incomplete_profile' ? (
        <label className="flex flex-col gap-1">
          Required questions, in priority order (source ids)
          <input name="required" className={field} placeholder="optional" />
        </label>
      ) : null}
      {trigger === 'registration' ? (
        <label className="flex items-center gap-2">
          <input name="onlyIncomplete" type="checkbox" /> Later steps only while the profile is incomplete
        </label>
      ) : null}
      {trigger === 'festival' ? (
        <label className="flex flex-col gap-1">
          Approved calendar date
          <select name="celebration" className={field} required>
            {celebrations
              .filter((c) => c.panel === panel)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        4. Approved template ({kinds.join(' or ').replace('_', ' ')})
        <select name="template" className={field} required>
          {usable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        5. Fewest days between messages
        <input name="spacing" type="number" min={1} max={365} defaultValue={7} className={field} />
      </label>
      <p className="text-fg-3 sm:col-span-2">
        Every message also passes the panel&apos;s contact gate: consent for its purpose, no minors, opt-outs, bounces,
        weekly and monthly caps, and quiet hours in the member&apos;s time zone. Channel: e-mail.
      </p>
      <div className="sm:col-span-2">
        <button className={btn.primary} disabled={pending || !usable.length}>
          Save as draft
        </button>
        {!usable.length ? <span className="ml-2 text-fg-3">Approve a {kinds.join(' or ')} template for this panel first.</span> : null}
      </div>
    </form>
  );
}

export function AutomationVersionButtons({ id, status }: { id: string; status: string }) {
  const { pending, act } = useAct();
  return (
    <span className="flex gap-1">
      {status === 'draft' || status === 'rejected' ? (
        <button className={btn.secondary} disabled={pending} onClick={() => act(() => automationVersionAction(id, 'submit'), 'Sent for review')}>
          Submit
        </button>
      ) : null}
      {status === 'in_review' ? (
        <>
          <button className={btn.primary} disabled={pending} onClick={() => act(() => automationVersionAction(id, 'approve'), 'Approved')}>
            Approve
          </button>
          <button className={btn.ghost} disabled={pending} onClick={() => act(() => automationVersionAction(id, 'reject'), 'Rejected')}>
            Reject
          </button>
        </>
      ) : null}
      {status === 'superseded' ? (
        <button className={btn.ghost} disabled={pending} onClick={() => act(() => automationVersionAction(id, 'restore'), 'Restored as a new draft')}>
          Restore
        </button>
      ) : null}
    </span>
  );
}

export function AutomationButtons({ id, status }: { id: string; status: string }) {
  const { pending, act } = useAct();
  const [asOf, setAsOf] = useState('');
  return (
    <span className="flex flex-wrap items-center gap-1">
      {status === 'active' ? (
        <>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className={field}
            aria-label="Evaluate as of (optional)"
            title="Evaluate as of this date (optional)"
          />
          <button
            className={btn.primary}
            disabled={pending}
            onClick={() => act(() => automationAction(id, 'dry_run', asOf ? new Date(`${asOf}T12:00:00Z`).toISOString() : undefined), 'Dry run finished')}
          >
            Dry run
          </button>
          <button className={btn.ghost} disabled={pending} onClick={() => act(() => automationAction(id, 'pause'), 'Paused')}>
            Pause
          </button>
        </>
      ) : null}
      {status === 'paused' ? (
        <button className={btn.secondary} disabled={pending} onClick={() => act(() => automationAction(id, 'resume'), 'Resumed')}>
          Resume
        </button>
      ) : null}
    </span>
  );
}
