import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, Table, fmt, fmtDate } from '@/components/ui';
import { IdeaButtons, PollForm, PublishToggle, StoryForm } from './forms';

export const metadata: Metadata = { title: 'Engagement' };

interface Task {
  id: string;
  kind: string;
  title: string;
  audience: string[];
  day: string | null;
  month: string | null;
  points: number;
  entries: number;
  waiting: number;
  active: boolean;
}
interface Idea {
  id: string;
  task: { title: string; points: number };
  text: string;
  status: string;
  by: string;
  at: string;
}
interface Story {
  id: string;
  type: string;
  title: string;
  summary: string;
  published: boolean;
  publishedAt: string | null;
}
interface Streaks {
  days: number;
  perDay: { day: string; members: number }[];
  currentStreaks: Record<'1-6' | '7-29' | '30+', number>;
}

export default async function EngagementPage() {
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Engagement"
        description="Daily polls, Teen creative tasks, monthly challenges, idea moderation, stories and streaks. Teen copy can't mention money; teen ideas are seen by moderators only until approved."
      />
      {await withPanel(async () => {
        const [tasks, stories, streaks, ideas] = await Promise.all([
          api<Task[]>('/panel/engagement/tasks'),
          api<Story[]>('/panel/engagement/stories'),
          api<Streaks>('/panel/engagement/streaks'),
          api<Idea[]>('/panel/engagement/ideas').catch(() => null),
        ]);
        const today = streaks.perDay.at(-1)?.members ?? 0;
        return (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Stat
                label="Active today"
                value={fmt(today)}
                tone="accent"
                hint="Members with a streak day today"
              />
              <Stat label="Streaks of 1 to 6 days" value={fmt(streaks.currentStreaks['1-6'])} />
              <Stat label="Streaks of 7 to 29 days" value={fmt(streaks.currentStreaks['7-29'])} />
              <Stat
                label="Streaks of 30 days or more"
                value={fmt(streaks.currentStreaks['30+'])}
                tone="teal"
              />
            </div>
            <Card>
              <CardHeader
                title="Ideas waiting for a moderator"
                hint="Points are paid when an idea is approved."
              />
              {ideas === null ? (
                <EmptyState title="Needs teen review access">
                  Teen ideas are a teen's own words, so they need the teen.review permission.
                </EmptyState>
              ) : ideas.length === 0 ? (
                <EmptyState title="Nothing waiting" />
              ) : (
                <Table head={['Idea', 'Task', 'From', 'Sent', '']}>
                  {ideas.map((i) => (
                    <tr key={i.id}>
                      <td className="max-w-md px-5 py-2.5">{i.text}</td>
                      <td className="px-5 py-2.5 text-[12px]">
                        {i.task.title} · {fmt(i.task.points)} pts
                      </td>
                      <td className="px-5 py-2.5">{i.by}</td>
                      <td className="px-5 py-2.5 text-[12px]">{fmtDate(i.at)}</td>
                      <td className="px-5 py-2.5">
                        <IdeaButtons id={i.id} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <PollForm />
            <Card>
              <CardHeader title={`Tasks (${fmt(tasks.length)})`} />
              {tasks.length === 0 ? (
                <EmptyState title="No tasks yet">
                  Daily polls come from the built-in rotation until you schedule one.
                </EmptyState>
              ) : (
                <Table head={['Task', 'Kind', 'For', 'When', 'Points', 'Answers', '']}>
                  {tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="px-5 py-2.5 font-medium">{t.title}</td>
                      <td className="px-5 py-2.5">{t.kind.replace('_', ' ')}</td>
                      <td className="px-5 py-2.5 text-[12px]">{t.audience.join(', ') || 'everyone'}</td>
                      <td className="px-5 py-2.5 font-mono text-[12px]">{t.day ?? t.month ?? '—'}</td>
                      <td className="num px-5 py-2.5">{fmt(t.points)}</td>
                      <td className="num px-5 py-2.5">
                        {fmt(t.entries)}
                        {t.waiting ? ` (${fmt(t.waiting)} waiting)` : ''}
                      </td>
                      <td className="px-5 py-2.5">
                        {t.active ? <Badge tone="teal">Live</Badge> : <Badge>Off</Badge>}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <StoryForm />
            <Card>
              <CardHeader
                title="Stories and insights"
                hint="An insight needs at least 30 respondents behind it."
              />
              {stories.length === 0 ? (
                <EmptyState title="No stories yet" />
              ) : (
                <Table head={['Story', 'Type', 'Status', '']}>
                  {stories.map((s) => (
                    <tr key={s.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{s.title}</p>
                        <p className="line-clamp-1 text-[12px] text-fg-3">{s.summary}</p>
                      </td>
                      <td className="px-5 py-2.5">{s.type}</td>
                      <td className="px-5 py-2.5">
                        {s.published ? (
                          <Badge tone="teal">Published {fmtDate(s.publishedAt)}</Badge>
                        ) : (
                          <Badge>Draft</Badge>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <PublishToggle id={s.id} published={s.published} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        );
      })}
    </>
  );
}
