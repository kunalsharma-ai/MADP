import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Card, CardHeader, EmptyState, PageHeader, Table, fmt, input, btn } from '@/components/ui';
import { ProfileRows, type ProfileRow } from './profile-rows';

export const metadata: Metadata = { title: 'Profiles' };

interface Completion {
  profiles: {
    slug: string;
    category: string;
    isActive: boolean;
    questions: number;
    members: number;
    started: number;
    finished: number;
    dropOff: { question: string; members: number } | null;
  }[];
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category = 'b2c' } = await searchParams;
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Profiles"
        description="Order, switch on or off and set the points for each profile of a segment. Points are paid when a member completes the profile; empty means the default of 50. Teen profiles keep the teen guardrails."
      />
      <form method="get" className="mb-4 flex items-end gap-2 text-[13px]">
        <label>
          Segment
          <select name="category" defaultValue={category} className={input}>
            <option value="b2c">Consumer (b2c)</option>
            <option value="b2b">Business Professional (b2b)</option>
            <option value="b2c-minor">Teen (b2c-minor)</option>
          </select>
        </label>
        <button className={btn.secondary}>Show</button>
      </form>
      {await withPanel(async () => {
        const q = `?category=${encodeURIComponent(category)}`;
        const [rows, completion] = await Promise.all([
          api<ProfileRow[]>(`/panel/profiles${q}`),
          api<Completion>(`/panel/profiles/completion${q}`),
        ]);
        return (
          <div className="grid gap-4">
            <Card>
              <CardHeader
                title={`${rows.length} profiles`}
                hint="Changes save one row at a time and go into the audit log."
              />
              {rows.length === 0 ? (
                <EmptyState title="No profiles in this segment" />
              ) : (
                <ProfileRows rows={rows} />
              )}
            </Card>
            <Card>
              <CardHeader
                title="Completion"
                hint="Members of the segment who answered at least one question (started) or all of them (finished), and the question where most starters stop."
              />
              <Table
                head={[
                  'Profile',
                  'Questions',
                  'Members',
                  'Started',
                  'Finished',
                  'Finish rate',
                  'Drop-off question',
                ]}
              >
                {completion.profiles.map((p) => (
                  <tr key={p.slug}>
                    <td className="px-5 py-2 font-mono">{p.slug}</td>
                    <td className="num px-5 py-2">{fmt(p.questions)}</td>
                    <td className="num px-5 py-2">{fmt(p.members)}</td>
                    <td className="num px-5 py-2">{fmt(p.started)}</td>
                    <td className="num px-5 py-2">{fmt(p.finished)}</td>
                    <td className="num px-5 py-2">{pct(p.finished, p.started)}</td>
                    <td className="px-5 py-2 font-mono text-fg-2">
                      {p.dropOff ? `${p.dropOff.question} (${fmt(p.dropOff.members)})` : '—'}
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        );
      })}
    </>
  );
}
