'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { AboutYouView } from '@madp/contracts';
import { aboutYouSaveAction } from '@/app/panel-actions';
import { Badge, btn, fmtDate, input } from '@/components/ui';

const SEGMENTS: Record<string, string> = {
  b2c: 'Consumer',
  b2b: 'Business Professional',
  'b2c-minor': 'Teen',
};
const SOURCE: Record<string, string> = {
  default: 'Default list',
  brand: 'Brand list',
  category: 'Own list',
};

/** One About You profile per line; the slugs that count for it separated by commas. */
const toText = (groups: string[][]) => groups.map((g) => g.join(', ')).join('\n');
const toGroups = (text: string) =>
  text
    .split('\n')
    .map((l) =>
      l
        .split(/[,/]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter((g) => g.length);

export function AboutYouLock({ view, canEdit }: { view: AboutYouView; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [useDefault, setUseDefault] = useState(!view.saved);
  const [brandText, setBrandText] = useState(toText(view.groups));
  const [own, setOwn] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(view.categories.map((c) => [c.category, c.ownGroups ? toText(c.ownGroups) : null])),
  );
  const [reason, setReason] = useState('');

  const save = () =>
    start(async () => {
      const byCategory: Record<string, string[][] | null> = {};
      for (const c of view.categories)
        byCategory[c.category] = own[c.category] === null ? null : toGroups(own[c.category] ?? '');
      const r = await aboutYouSaveAction({
        groups: useDefault ? null : toGroups(brandText),
        byCategory,
        reason,
      });
      if (!r.ok) return void toast.error(r.error);
      setReason('');
      toast.success('Saved. The panel uses the new list from the next survey or profile a member opens.');
    });

  return (
    <div className="grid gap-4 p-5 text-[13px]">
      <p className="text-fg-2">
        Until a member has finished these profiles, the panel does not open any survey (also from a direct
        survey link) or any other profile. Write one About You profile per line. If panels use different slugs
        for the same profile, put them on one line with commas: the first one the segment has is used.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 font-medium">Brand list</div>
          <label className="mb-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={useDefault}
              disabled={!canEdit}
              onChange={(e) => {
                setUseDefault(e.target.checked);
                if (e.target.checked) setBrandText(toText(view.defaultGroups));
              }}
            />
            Use the default (Basic, Educational, Finance, Health)
          </label>
          <textarea
            rows={5}
            value={brandText}
            disabled={!canEdit || useDefault}
            onChange={(e) => setBrandText(e.target.value)}
            className={`${input} w-full font-mono`}
            aria-label="About You profiles for the whole brand"
          />
        </div>
        <div className="grid gap-3">
          {view.categories.map((c) => (
            <div key={c.category} className="rounded-lg border border-border p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-medium">{SEGMENTS[c.category] ?? c.category}</span>
                <span className="font-mono text-[11px] text-fg-3">{c.category}</span>
                <Badge tone={c.source === 'category' ? 'teal' : 'neutral'}>{SOURCE[c.source]}</Badge>
              </div>
              <div className="mb-2 text-fg-2">
                {c.aboutYou.length ? (
                  <>
                    About You: {c.aboutYou.map((p) => p.name).join(', ')}. {c.locked} other{' '}
                    {c.locked === 1 ? 'profile stays' : 'profiles stay'} locked until then.
                  </>
                ) : (
                  'Nothing is locked for this segment.'
                )}
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={own[c.category] !== null}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setOwn((o) => ({
                      ...o,
                      [c.category]: e.target.checked ? toText(c.aboutYou.map((p) => [p.slug])) : null,
                    }))
                  }
                />
                Own list for this segment
              </label>
              {own[c.category] !== null && (
                <textarea
                  rows={3}
                  value={own[c.category] ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => setOwn((o) => ({ ...o, [c.category]: e.target.value }))}
                  className={`${input} mt-2 w-full font-mono`}
                  placeholder="Empty = nothing locked for this segment"
                  aria-label={`About You profiles for ${c.category}`}
                />
              )}
              <div className="mt-2 font-mono text-[11px] text-fg-3">
                Profiles: {c.profiles.map((p) => p.slug).join(', ') || 'none'}
              </div>
            </div>
          ))}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grow">
            Reason (goes into the audit log)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${input} w-full`}
              placeholder="e.g. MFR keeps Professional instead of Health"
            />
          </label>
          <button className={btn.primary} disabled={pending || reason.trim().length < 5} onClick={save}>
            Save About You lock
          </button>
        </div>
      )}
      {view.history.length > 0 && (
        <div className="text-[12px] text-fg-3">
          Last change: {fmtDate(view.history[0].at)}, “{view.history[0].reason}”
        </div>
      )}
    </div>
  );
}
