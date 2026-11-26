'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  BellRing,
  Gift,
  KeyRound,
  ListChecks,
  Mail,
  MessageCircle,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import type { ReminderCaseKey, ReminderCaseView, RemindersView } from '@madp/contracts';
import { previewRemindersAction, saveRemindersAction } from '@/app/reminders-actions';
import { TopicInfo } from '@/components/screen-info';
import { Toggle } from '@/components/toggle';
import { Badge, btn, fmtDate, input } from '@/components/ui';

const GROUPS: { key: ReminderCaseView['group']; title: string; icon: typeof Sparkles; tint: string }[] = [
  { key: 'signup', title: 'Finish signing up', icon: KeyRound, tint: '#6366f1' },
  { key: 'profile', title: 'Complete the profile', icon: ListChecks, tint: '#0ea5e9' },
  { key: 'surveys', title: 'Surveys waiting', icon: Sparkles, tint: '#10b981' },
  { key: 'rewards', title: 'Rewards and streaks', icon: Gift, tint: '#f59e0b' },
];

type Preview = {
  checked: number;
  due: number;
  byCase: Record<string, number>;
  limited: boolean;
  switchOn: boolean;
};
const small = input.replace('w-full ', '');
const fmtN = (n: number) => new Intl.NumberFormat('en-IN').format(n);

export function RemindersForm({
  brand,
  view,
}: {
  brand: string;
  view: RemindersView & { canEdit: boolean; canFlip: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cases, setCases] = useState(() => Object.fromEntries(view.cases.map((c) => [c.key, { ...c }])));
  const [gap, setGap] = useState(view.minGapDays);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const dirty =
    gap !== view.minGapDays ||
    view.cases.some((c) => {
      const n = cases[c.key]!;
      return n.enabled !== c.enabled || n.everyDays !== c.everyDays || n.max !== c.max;
    });
  const set = (k: string, patch: Partial<ReminderCaseView>) =>
    setCases((s) => ({ ...s, [k]: { ...s[k]!, ...patch } }));

  const save = () =>
    start(async () => {
      const body = {
        reason,
        minGapDays: gap,
        cases: Object.fromEntries(
          Object.values(cases).map((c) => [
            c.key,
            { enabled: c.enabled, everyDays: c.everyDays, max: c.max },
          ]),
        ) as Partial<Record<ReminderCaseKey, { enabled: boolean; everyDays: number; max: number }>>,
      };
      const r = await saveRemindersAction(body);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Reminder settings saved for ${brand.toUpperCase()}.`);
      setReason('');
      setPreview(null);
      router.refresh();
    });
  const check = () =>
    start(async () => {
      const r = await previewRemindersAction();
      if (!r.ok) return void toast.error(r.error);
      setPreview(r.data);
    });

  const channels: { key: string; label: string; on: boolean; icon: typeof Mail; note: string }[] = [
    {
      key: 'email_reminders',
      label: 'E-mail',
      on: view.switches.email_reminders,
      icon: Mail,
      note: 'registered e-mail',
    },
    {
      key: 'push',
      label: 'Push',
      on: view.switches.push,
      icon: BellRing,
      note: 'when the member allowed it',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      on: view.switches.whatsapp,
      icon: MessageCircle,
      note: 'when the member chose it',
    },
    { key: 'sms', label: 'SMS', on: view.switches.sms, icon: Smartphone, note: 'when the member chose it' },
  ];

  return (
    <section
      aria-label="Reminder rules"
      className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
    >
      <div className="flex flex-wrap items-center gap-2 bg-gradient-to-r from-[#6366f1] via-[#0ea5e9] to-[#10b981] px-5 py-3 text-white">
        <BellRing className="size-4" aria-hidden />
        <h2 className="text-[15px] font-bold">Reminders for {brand.toUpperCase()}</h2>
        <TopicInfo
          title="Auto reminders"
          help={{
            why: 'Many members sign up and stop half-way. A polite nudge at the right time brings them back without anyone writing a mail.',
            where:
              'The panel checks every member a few times a day. Nothing here uses AI: each reminder is a plain rule.',
            how: [
              'Turn on the reminders you want and set every how many days and at most how many times.',
              'A member gets at most one reminder in the gap you set, whatever the case.',
              'A reminder stops on its own once the member does the thing (for example sets a password).',
              'Sending stays behind the switches below. Until Super Admin turns them on, only the dashboard notice is made.',
            ],
          }}
        />
        <span className="ml-auto text-[12px] opacity-90">
          {view.updatedAt
            ? `Last changed ${fmtDate(view.updatedAt)}`
            : 'Not set up yet: every reminder is off'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 text-[12px]">
        <span className="font-semibold text-fg-2">Sends on:</span>
        <Badge tone="teal">Dashboard · always</Badge>
        {channels.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5"
            title={c.note}
          >
            <c.icon className="size-3.5" aria-hidden style={{ color: c.on ? '#16a34a' : '#94a3b8' }} />
            {c.label} {c.on ? 'on' : 'off'}
          </span>
        ))}
        <Link href="/switches" className="ml-auto font-semibold text-accent hover:underline">
          {view.canFlip ? 'Change switches' : 'See switches'}
        </Link>
      </div>

      <div className="grid gap-3 p-5 md:grid-cols-2">
        {GROUPS.map((g) => {
          const list = view.cases.filter((c) => c.group === g.key);
          if (!list.length) return null;
          return (
            <div key={g.key} className="rounded-xl border border-border bg-surface-2/40 p-3">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-bold">
                <span
                  className="grid size-7 place-items-center rounded-lg text-white"
                  style={{ background: g.tint }}
                  aria-hidden
                >
                  <g.icon className="size-4" />
                </span>
                {g.title}
              </p>
              <ul className="grid gap-2">
                {list.map((c) => {
                  const n = cases[c.key]!;
                  return (
                    <li key={c.key} className="grid gap-1.5 rounded-lg bg-surface px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Toggle
                          on={n.enabled}
                          size="sm"
                          label={`${c.label}: ${n.enabled ? 'on' : 'off'}`}
                          readOnly={!view.canEdit}
                          onClick={() => set(c.key, { enabled: !n.enabled })}
                        />
                        <span className="text-[13px] font-medium">{c.label}</span>
                        {c.kind === 'account' ? <Badge>account</Badge> : null}
                        {preview ? (
                          <span className="ml-auto text-[12px] text-fg-2">
                            {fmtN(preview.byCase[c.key] ?? 0)} due now
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-2">
                        Every
                        <input
                          type="number"
                          min={1}
                          max={90}
                          className={`${small} w-16 px-2 py-1`}
                          value={n.everyDays}
                          disabled={!view.canEdit}
                          aria-label={`${c.label}: every how many days`}
                          onChange={(e) => set(c.key, { everyDays: Number(e.target.value) || 1 })}
                        />
                        days, at most
                        <input
                          type="number"
                          min={1}
                          max={50}
                          className={`${small} w-16 px-2 py-1`}
                          value={n.max}
                          disabled={!view.canEdit}
                          aria-label={`${c.label}: at most how many times`}
                          onChange={(e) => set(c.key, { max: Number(e.target.value) || 1 })}
                        />
                        times
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-4 text-[13px]">
        <label className="grid gap-1">
          <span className="text-fg-2">At most one reminder per member every</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={30}
              className={`${small} w-20`}
              value={gap}
              disabled={!view.canEdit}
              onChange={(e) => setGap(Number(e.target.value) || 1)}
            />
            days
          </span>
        </label>
        {view.canEdit ? (
          <>
            <label className="grid min-w-64 flex-1 gap-1">
              <span className="text-fg-2">Reason for the change (kept in the audit log)</span>
              <input
                className={input}
                value={reason}
                placeholder="e.g. Turn on profile reminders every 12 days"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={btn.primary}
              disabled={pending || !dirty || reason.trim().length < 5}
              onClick={save}
            >
              Save
            </button>
          </>
        ) : (
          <p className="text-fg-3">You can see these settings. Changing them needs Communications manage.</p>
        )}
        <button type="button" className={btn.secondary} disabled={pending} onClick={check}>
          Who is due now?
        </button>
      </div>
      {preview ? (
        <p className="border-t border-border bg-surface-2/40 px-5 py-2.5 text-[12px] text-fg-2" role="status">
          Checked {fmtN(preview.checked)} members{preview.limited ? ' (the first part only)' : ''}:{' '}
          <strong className="text-fg">{fmtN(preview.due)}</strong> would get a reminder now, with the saved
          settings. Nothing was sent.{' '}
          {preview.switchOn ? '' : 'E-mail reminders are off, so only dashboard notices would be made.'}
        </p>
      ) : null}
    </section>
  );
}
