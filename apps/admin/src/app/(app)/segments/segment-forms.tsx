'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { audienceCountAction, audienceSaveAction, segmentSaveAction } from '@/app/panel-actions';
import { Card, CardHeader, btn, fmt, input } from '@/components/ui';

export interface Segment {
  id: string;
  name: string;
  settings: {
    signupOpen: boolean;
    countries: string[];
    minAge: number;
    coreProfiles: string[];
    theme: string | null;
  };
  members: Record<string, number>;
}
const THEMES = ['consumer', 'professional', 'teen', 'healthcare', 'patient', 'caregiver'];
const list = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export function SegmentEditor({ segments }: { segments: Segment[] }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(segments[0]?.name ?? '');
  const seg = segments.find((s) => s.name === name);
  const [open, setOpen] = useState(seg?.settings.signupOpen ?? true);
  const [countries, setCountries] = useState(seg?.settings.countries.join(', ') ?? '');
  const [minAge, setMinAge] = useState(String(seg?.settings.minAge ?? 18));
  const [core, setCore] = useState(seg?.settings.coreProfiles.join(', ') ?? '');
  const [theme, setTheme] = useState(seg?.settings.theme ?? '');
  const [reason, setReason] = useState('');
  const pick = (n: string) => {
    const s = segments.find((x) => x.name === n);
    setName(n);
    if (!s) return;
    setOpen(s.settings.signupOpen);
    setCountries(s.settings.countries.join(', '));
    setMinAge(String(s.settings.minAge));
    setCore(s.settings.coreProfiles.join(', '));
    setTheme(s.settings.theme ?? '');
  };
  const save = () =>
    start(async () => {
      const r = await segmentSaveAction(
        name,
        {
          signupOpen: open,
          countries: list(countries),
          minAge: Number(minAge),
          coreProfiles: list(core),
          theme: theme || null,
        },
        reason,
      );
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${name} saved`);
      setReason('');
    });
  if (!segments.length) return null;
  return (
    <Card>
      <CardHeader title="Edit a segment" hint="Teens can't be set below 13, other segments below 18." />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-6">
        <label>
          Segment
          <select className={input} value={name} onChange={(e) => pick(e.target.value)}>
            {segments.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          Sign-up
          <select
            className={input}
            value={open ? 'open' : 'closed'}
            onChange={(e) => setOpen(e.target.value === 'open')}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label>
          Countries (empty = any)
          <input
            className={input}
            value={countries}
            onChange={(e) => setCountries(e.target.value)}
            placeholder="us, ca"
          />
        </label>
        <label>
          Minimum age
          <input className={input} type="number" value={minAge} onChange={(e) => setMinAge(e.target.value)} />
        </label>
        <label>
          Core profiles
          <input
            className={input}
            value={core}
            onChange={(e) => setCore(e.target.value)}
            placeholder="basic, household"
          />
        </label>
        <label>
          Theme
          <select className={input} value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="">None</option>
            {THEMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="md:col-span-4">
          Reason
          <input
            className={input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why, in a sentence"
          />
        </label>
        <div className="flex items-end md:col-span-2">
          <button className={btn.primary} disabled={pending || reason.trim().length < 5} onClick={save}>
            Save segment
          </button>
        </div>
      </div>
    </Card>
  );
}

export function AudienceBuilder({ segments }: { segments: string[] }) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    categories: '',
    countries: '',
    ageMin: '',
    ageMax: '',
    qualityMin: '',
    activeWithinDays: '',
    verified: '',
    question: '',
    values: '',
  });
  const [count, setCount] = useState<{ count: number; bySegment: Record<string, number> } | null>(null);
  const [name, setName] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value });
    setCount(null);
  };
  const filter = () => {
    const out: Record<string, unknown> = {};
    if (f.categories) out.categories = [f.categories];
    if (f.countries) out.countries = list(f.countries);
    for (const k of ['ageMin', 'ageMax', 'qualityMin', 'activeWithinDays'] as const)
      if (f[k]) out[k] = Number(f[k]);
    if (f.verified) out.verifiedEmail = f.verified === 'yes';
    if (f.question && f.values)
      out.answers = [
        {
          question: f.question.trim().toLowerCase(),
          values: f.values
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        },
      ];
    return out;
  };
  const doCount = () =>
    start(async () => {
      const r = await audienceCountAction(filter());
      if (!r.ok) return void toast.error(r.error);
      setCount(r.data);
    });
  const save = () =>
    start(async () => {
      const r = await audienceSaveAction(name, '', filter());
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Saved: ${fmt(r.data.count)} members`);
      setName('');
    });
  return (
    <Card>
      <CardHeader
        title="Audience builder"
        hint="Count first. Archived, suspended and banned members never count."
      />
      <div className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-6">
        <label>
          Segment
          <select className={input} value={f.categories} onChange={set('categories')}>
            <option value="">Any</option>
            {segments.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Countries
          <input className={input} value={f.countries} onChange={set('countries')} placeholder="us, gb" />
        </label>
        <label>
          Age from
          <input className={input} type="number" value={f.ageMin} onChange={set('ageMin')} />
        </label>
        <label>
          Age to
          <input className={input} type="number" value={f.ageMax} onChange={set('ageMax')} />
        </label>
        <label>
          Quality from
          <input className={input} type="number" value={f.qualityMin} onChange={set('qualityMin')} />
        </label>
        <label>
          Active within (days)
          <input
            className={input}
            type="number"
            value={f.activeWithinDays}
            onChange={set('activeWithinDays')}
          />
        </label>
        <label>
          E-mail verified
          <select className={input} value={f.verified} onChange={set('verified')}>
            <option value="">Any</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="md:col-span-2">
          Answered question (key)
          <input className={input} value={f.question} onChange={set('question')} placeholder="q_pets" />
        </label>
        <label className="md:col-span-3">
          With any of these answers
          <input className={input} value={f.values} onChange={set('values')} placeholder="dog, cat" />
        </label>
        <div className="flex flex-wrap items-center gap-2 md:col-span-6">
          <button className={btn.secondary} disabled={pending} onClick={doCount}>
            Count
          </button>
          {count ? (
            <span>
              <strong className="num">{fmt(count.count)}</strong> active members
              {Object.keys(count.bySegment).length
                ? ` (${Object.entries(count.bySegment)
                    .map(([k, v]) => `${k} ${fmt(v)}`)
                    .join(', ')})`
                : ''}
            </span>
          ) : null}
          <input
            className={`${input} ml-auto max-w-xs`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name to save as"
          />
          <button
            className={btn.primary}
            disabled={pending || !count || name.trim().length < 2}
            onClick={save}
          >
            Save audience
          </button>
        </div>
      </div>
    </Card>
  );
}
