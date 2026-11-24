'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { profileSaveAction } from '@/app/panel-actions';
import { Badge, btn, input } from '@/components/ui';

const GRID = 'grid grid-cols-[120px_1fr_100px_130px_120px_90px_80px] items-center';

export interface ProfileRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  points: number | null;
  estimatedMinutes: number | null;
  questions: number;
}

export function ProfileRows({ rows }: { rows: ProfileRow[] }) {
  const [pending, start] = useTransition();
  const save = (id: string, patch: Record<string, unknown>) =>
    start(async () => {
      const r = await profileSaveAction(id, patch);
      if (!r.ok) return void toast.error(r.error);
      toast.success('Saved');
    });
  const n = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));
  return (
    <div className="overflow-x-auto text-[13px]">
      <div
        className={`${GRID} min-w-[800px] border-b border-border text-[11px] uppercase tracking-wider text-fg-3`}
      >
        {['Order', 'Profile', 'Questions', 'Points', 'Minutes', 'Status', ''].map((h, i) => (
          <div key={i} className="px-5 py-2.5 font-medium">
            {h}
          </div>
        ))}
      </div>
      {rows.map((p) => (
        <div key={p.id} className="min-w-[800px] border-b border-border last:border-0">
          <form
            className={GRID}
            action={(f) =>
              save(p.id, {
                sortOrder: Number(f.get('sortOrder')),
                points: n(f.get('points')),
                estimatedMinutes: n(f.get('estimatedMinutes')),
              })
            }
          >
            <div className="px-5 py-2">
              <input
                name="sortOrder"
                type="number"
                min={0}
                defaultValue={p.sortOrder}
                className={`${input} py-1`}
              />
            </div>
            <div className="px-5 py-2">
              <span className="mr-1.5">{p.icon}</span>
              <span className="font-medium capitalize">{p.name}</span>
              <div className="font-mono text-[11px] text-fg-3">{p.slug}</div>
            </div>
            <div className="num px-5 py-2">{p.questions}</div>
            <div className="px-5 py-2">
              <input
                name="points"
                type="number"
                min={0}
                placeholder="50"
                defaultValue={p.points ?? ''}
                className={`${input} py-1`}
              />
            </div>
            <div className="px-5 py-2">
              <input
                name="estimatedMinutes"
                type="number"
                min={1}
                defaultValue={p.estimatedMinutes ?? ''}
                className={`${input} py-1`}
              />
            </div>
            <div className="px-5 py-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => save(p.id, { isActive: !p.isActive })}
                title="Switch on or off"
              >
                <Badge tone={p.isActive ? 'teal' : 'neutral'}>{p.isActive ? 'On' : 'Off'}</Badge>
              </button>
            </div>
            <div className="px-5 py-2">
              <button className={btn.ghost} disabled={pending}>
                Save
              </button>
            </div>
          </form>
        </div>
      ))}
    </div>
  );
}
