'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BellOff, Pencil, Plus, Siren, Trash2 } from 'lucide-react';
import {
  ALERT_METRIC_LABELS,
  type AlertMetric,
  type AlertRuleInput,
  type AlertRuleView,
  type AlertRules,
} from '@madp/contracts';
import { muteAlertRuleAction, removeAlertRuleAction, saveAlertRuleAction } from '@/app/alert-rules-actions';
import { BrandLogo } from '@/components/brand-logo';
import { TopicInfo } from '@/components/screen-info';
import { Toggle } from '@/components/toggle';
import { Badge, EmptyState, btn, fmtDate, input } from '@/components/ui';
import { cn } from '@/lib/cn';

type Panel = { code: string; name: string; shortName: string };
type Segment = { key: string; label: string };
const fmtN = (n: number) => new Intl.NumberFormat('en-IN').format(n);
const BLANK: AlertRuleInput = {
  name: '',
  panel: null,
  metric: 'signups',
  segment: null,
  comparator: 'above',
  threshold: 10,
  window: 'hour',
  enabled: true,
};
const EXAMPLES: AlertRuleInput[] = [
  {
    name: 'Sign-up spike',
    panel: null,
    metric: 'signups',
    segment: null,
    comparator: 'above',
    threshold: 50,
    window: 'hour',
  },
  {
    name: 'Quiet day: few sign-ups',
    panel: null,
    metric: 'signups',
    segment: null,
    comparator: 'below',
    threshold: 5,
    window: 'day',
  },
  {
    name: 'Survey completes dropped',
    panel: null,
    metric: 'completes',
    segment: null,
    comparator: 'below',
    threshold: 20,
    window: 'day',
  },
  {
    name: 'Many redemptions',
    panel: null,
    metric: 'redemptions',
    segment: null,
    comparator: 'above',
    threshold: 30,
    window: 'hour',
  },
];

function sentence(r: AlertRuleInput, panels: Panel[], segments: Segment[]) {
  const where = r.panel
    ? (panels.find((p) => p.code === r.panel)?.shortName ?? r.panel.toUpperCase())
    : 'any panel';
  const seg = r.segment ? ` (${segments.find((s) => s.key === r.segment)?.label ?? r.segment})` : '';
  return `${ALERT_METRIC_LABELS[r.metric].toLowerCase()}${seg} on ${where} in the last ${r.window} ${r.comparator === 'above' ? 'goes above' : 'drops below'} ${fmtN(r.threshold)}`;
}

function RuleForm({
  start: initial,
  id,
  panels,
  segments,
  onDone,
}: {
  start: AlertRuleInput;
  id: string | null;
  panels: Panel[];
  segments: Segment[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<AlertRuleInput>(initial);
  const set = (patch: Partial<AlertRuleInput>) => setF((x) => ({ ...x, ...patch }));
  const save = () =>
    start(async () => {
      const r = await saveAlertRuleAction(id, {
        ...f,
        segment: f.metric === 'signups' ? f.segment || null : null,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(id ? 'Rule saved' : 'Rule added. The siren next to the bell lights up when it fires.');
      onDone();
      router.refresh();
    });
  const label = 'grid gap-1 text-[12px] text-fg-2';
  return (
    <div className="grid gap-3 rounded-2xl border border-accent/40 bg-surface-2/50 p-4">
      <p className="text-[13px] font-semibold">
        Tell me when <span className="text-accent">{sentence(f, panels, segments)}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={cn(label, 'sm:col-span-2')}>
          Name
          <input
            className={input}
            value={f.name}
            maxLength={80}
            placeholder="e.g. MHO patient sign-up spike"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className={label}>
          Watch
          <select
            className={input}
            value={f.metric}
            onChange={(e) => set({ metric: e.target.value as AlertMetric })}
          >
            {(Object.keys(ALERT_METRIC_LABELS) as AlertMetric[]).map((k) => (
              <option key={k} value={k}>
                {ALERT_METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Panel
          <select
            className={input}
            value={f.panel ?? ''}
            onChange={(e) => set({ panel: (e.target.value || null) as AlertRuleInput['panel'] })}
          >
            <option value="">Each of my panels</option>
            {panels.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {f.metric === 'signups' ? (
          <label className={label}>
            Segment
            <select
              className={input}
              value={f.segment ?? ''}
              onChange={(e) => set({ segment: e.target.value || null })}
            >
              <option value="">Every segment</option>
              {segments.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={label}>
          Over
          <select
            className={input}
            value={f.window}
            onChange={(e) => set({ window: e.target.value as 'hour' | 'day' })}
          >
            <option value="hour">the last hour</option>
            <option value="day">the last 24 hours</option>
          </select>
        </label>
        <label className={label}>
          When it goes
          <select
            className={input}
            value={f.comparator}
            onChange={(e) => set({ comparator: e.target.value as 'above' | 'below' })}
          >
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
        </label>
        <label className={label}>
          Limit
          <input
            className={input}
            type="number"
            min={0}
            max={1000000}
            value={f.threshold}
            onChange={(e) => set({ threshold: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn.primary}
          disabled={pending || f.name.trim().length < 3}
          onClick={save}
        >
          {id ? 'Save rule' : 'Add rule'}
        </button>
        <button type="button" className={btn.secondary} disabled={pending} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RuleCard({ r, panels, segments }: { r: AlertRuleView; panels: Panel[]; segments: Segment[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const firing = r.current.some((c) => c.firing);
  const muted = r.mutedUntil && Date.parse(r.mutedUntil) > Date.now();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const x = await fn();
      if (!x.ok) return void toast.error(x.error ?? 'Failed');
      toast.success(done);
      router.refresh();
    });
  const input0: AlertRuleInput = {
    name: r.name,
    panel: r.panel as AlertRuleInput['panel'],
    metric: r.metric,
    segment: r.segment,
    comparator: r.comparator,
    threshold: r.threshold,
    window: r.window,
    enabled: r.enabled,
  };
  if (editing)
    return (
      <RuleForm
        start={input0}
        id={r.id}
        panels={panels}
        segments={segments}
        onDone={() => setEditing(false)}
      />
    );
  return (
    <li
      className={cn(
        'rise grid gap-3 rounded-2xl border bg-surface p-4 shadow-soft',
        firing ? 'border-[#f59e0b]/60 shadow-[0_8px_24px_-12px_rgba(245,158,11,0.6)]' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'grid size-8 place-items-center rounded-xl text-white',
            firing ? 'bg-gradient-to-br from-[#f59e0b] to-[#f97316]' : 'bg-fg-3/40',
          )}
          aria-hidden
        >
          <Siren className={cn('size-4', firing ? 'bell-swing' : '')} />
        </span>
        <p className="text-[14px] font-bold">{r.name}</p>
        {firing ? (
          <Badge tone="warn">Firing</Badge>
        ) : r.enabled ? (
          <Badge tone="teal">Watching</Badge>
        ) : (
          <Badge>Off</Badge>
        )}
        {muted ? <Badge>Muted until {fmtDate(r.mutedUntil)}</Badge> : null}
        <span className="ml-auto flex items-center gap-1">
          <Toggle
            on={r.enabled}
            size="sm"
            label={`${r.name}: ${r.enabled ? 'on' : 'off'}`}
            pending={pending}
            onClick={() =>
              run(
                () => saveAlertRuleAction(r.id, { ...input0, enabled: !r.enabled }),
                r.enabled ? 'Rule turned off' : 'Rule turned on',
              )
            }
          />
          <button
            type="button"
            className={btn.ghost}
            onClick={() => setEditing(true)}
            aria-label={`Edit ${r.name}`}
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={btn.ghost}
            disabled={pending}
            onClick={() =>
              run(() => muteAlertRuleAction(r.id, muted ? 0 : 4), muted ? 'Unmuted' : 'Muted for 4 hours')
            }
            title={muted ? 'Unmute' : 'Mute for 4 hours'}
            aria-label={muted ? `Unmute ${r.name}` : `Mute ${r.name} for 4 hours`}
          >
            <BellOff className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={btn.ghost}
            disabled={pending}
            onClick={() => run(() => removeAlertRuleAction(r.id), 'Rule removed')}
            aria-label={`Remove ${r.name}`}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>
      <p className="text-[12px] text-fg-2">Tell me when {sentence(input0, panels, segments)}.</p>
      <ul className="flex flex-wrap gap-2">
        {r.current.map((c) => (
          <li
            key={c.panel}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[12px]',
              c.firing
                ? 'border-[#f59e0b]/60 bg-[color-mix(in_oklab,#f59e0b_10%,transparent)]'
                : 'border-border bg-surface-2/50',
            )}
          >
            <BrandLogo panel={c.panel} size={20} label={panels.find((p) => p.code === c.panel)?.shortName} />
            {c.value === null ? (
              <span className="text-fg-3">no access</span>
            ) : (
              <strong className="num">{fmtN(c.value)}</strong>
            )}
            <span className="text-fg-3">now</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function RulesBoard({
  data,
  panels,
  segments,
}: {
  data: AlertRules;
  panels: Panel[];
  segments: Segment[];
}) {
  const [adding, setAdding] = useState<AlertRuleInput | null>(null);
  return (
    <section aria-label="Your alert rules" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold">Your rules ({data.rules.length})</h2>
        <TopicInfo
          title="Alert rules"
          help={{
            why: 'Spot a sudden spike or a quiet day without watching the screens all day.',
            where:
              'Counts from MADP’s synced copy of each panel, worked out each time the console checks (every two minutes).',
            how: [
              'Add a rule, or start from an example below.',
              '“Each of my panels” checks every panel you can see, one by one.',
              'The amber siren next to the bell shows rules that are firing. Mute a rule for 4 hours when you have seen it.',
            ],
          }}
        />
        {!adding ? (
          <button type="button" className={cn(btn.primary, 'ml-auto')} onClick={() => setAdding(BLANK)}>
            <Plus className="size-4" aria-hidden /> Add rule
          </button>
        ) : null}
      </div>
      {adding ? (
        <RuleForm
          start={adding}
          id={null}
          panels={panels}
          segments={segments}
          onDone={() => setAdding(null)}
        />
      ) : null}
      {data.rules.length ? (
        <ul className="grid gap-3 xl:grid-cols-2">
          {data.rules.map((r) => (
            <RuleCard key={r.id} r={r} panels={panels} segments={segments} />
          ))}
        </ul>
      ) : !adding ? (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
          <EmptyState title="No alert rules yet">
            Start from one of these, then change the numbers to suit you.
          </EmptyState>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((e) => (
              <button
                key={e.name}
                type="button"
                onClick={() => setAdding(e)}
                className="rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-left text-[12px] transition hover:-translate-y-px hover:border-accent"
              >
                <span className="block font-semibold text-fg">{e.name}</span>
                <span className="text-fg-2">{sentence(e, panels, segments)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
