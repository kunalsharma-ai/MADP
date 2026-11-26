import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmt, fmtDate } from '@/components/ui';
import { AudienceBuilder, SegmentEditor, type Segment } from './segment-forms';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Segments & audiences' };

interface Audience {
  id: string;
  name: string;
  description: string;
  filter: Record<string, unknown>;
  lastCount: number | null;
  lastCountAt: string | null;
}

const describe = (f: Record<string, unknown>) =>
  Object.entries(f)
    .map(
      ([k, v]) =>
        `${k}: ${Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : String(v)}`,
    )
    .join(' · ') || 'Everyone active';

export default async function SegmentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Segments & audiences"
        description="Segments are the panel categories members join (consumer, professional, teen). Their sign-up rules apply to new sign-ups only. Audiences are saved filters; only active members count, and only counts leave the panel."
      />
      {await withPanel(async () => {
        const [segments, audiences] = await Promise.all([
          api<Segment[]>('/panel/segments'),
          api<Audience[]>('/panel/audiences'),
        ]);
        return (
          <div className="grid gap-4">
            <Card>
              <CardHeader
                title={`${segments.length} segments`}
                hint="Member counts by status. Changing a rule needs a reason and is audited."
                action={
                  <DownloadMenu
                    screen="segments"
                    title="Segments"
                    columns={[
                      { key: 'name', label: 'Segment' },
                      { key: 'signup', label: 'Sign-up' },
                      { key: 'countries', label: 'Countries' },
                      { key: 'minAge', label: 'Min age', type: 'number' },
                      { key: 'core', label: 'Core profiles' },
                      { key: 'theme', label: 'Theme' },
                      { key: 'active', label: 'Active', type: 'number' },
                      { key: 'suspended', label: 'Suspended', type: 'number' },
                      { key: 'archived', label: 'Archived', type: 'number' },
                    ]}
                    rows={segments.map((s) => ({
                      name: s.name,
                      signup: s.settings.signupOpen ? 'open' : 'closed',
                      countries: s.settings.countries.length
                        ? s.settings.countries.join(', ').toUpperCase()
                        : 'any',
                      minAge: s.settings.minAge,
                      core: s.settings.coreProfiles.join(', '),
                      theme: s.settings.theme,
                      active: s.members.active ?? 0,
                      suspended: s.members.suspended ?? 0,
                      archived: s.members.archived ?? 0,
                    }))}
                  />
                }
              />
              {segments.length === 0 ? (
                <EmptyState title="No segments" />
              ) : (
                <Table
                  head={[
                    'Segment',
                    'Sign-up',
                    'Countries',
                    'Min age',
                    'Core profiles',
                    'Theme',
                    'Active',
                    'Suspended',
                    'Archived',
                  ]}
                >
                  {segments.map((s) => (
                    <tr key={s.id}>
                      <td className="px-5 py-2.5 font-medium">{s.name}</td>
                      <td className="px-5 py-2.5">
                        <Badge tone={s.settings.signupOpen ? 'teal' : 'warn'}>
                          {s.settings.signupOpen ? 'open' : 'closed'}
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5 uppercase">
                        {s.settings.countries.length ? s.settings.countries.join(', ') : 'any'}
                      </td>
                      <td className="num px-5 py-2.5">{s.settings.minAge}</td>
                      <td className="px-5 py-2.5">
                        {s.settings.coreProfiles.length ? s.settings.coreProfiles.join(', ') : '—'}
                      </td>
                      <td className="px-5 py-2.5">{s.settings.theme ?? '—'}</td>
                      <td className="num px-5 py-2.5">{fmt(s.members.active ?? 0)}</td>
                      <td className="num px-5 py-2.5">{fmt(s.members.suspended ?? 0)}</td>
                      <td className="num px-5 py-2.5">{fmt(s.members.archived ?? 0)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <SegmentEditor segments={segments} />
            <AudienceBuilder segments={segments.map((s) => s.name)} />
            <Card>
              <CardHeader
                title={`${audiences.length} saved audiences`}
                hint="Use one when inviting members to a survey."
                action={
                  <DownloadMenu
                    screen="segments"
                    title="Saved audiences"
                    columns={[
                      { key: 'name', label: 'Audience' },
                      { key: 'description', label: 'Description' },
                      { key: 'filter', label: 'Filter' },
                      { key: 'members', label: 'Members', type: 'number' },
                      { key: 'counted', label: 'Counted', type: 'date' },
                    ]}
                    rows={audiences.map((a) => ({
                      name: a.name,
                      description: a.description,
                      filter: describe(a.filter),
                      members: a.lastCount,
                      counted: a.lastCountAt,
                    }))}
                  />
                }
              />
              {audiences.length === 0 ? (
                <EmptyState title="No saved audiences yet">
                  Build a filter above, check the count, then save it.
                </EmptyState>
              ) : (
                <Table head={['Audience', 'Filter', 'Members', 'Counted']}>
                  {audiences.map((a) => (
                    <tr key={a.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{a.name}</p>
                        {a.description ? <p className="text-[12px] text-fg-3">{a.description}</p> : null}
                      </td>
                      <td className="px-5 py-2.5 text-[12px] text-fg-2">{describe(a.filter)}</td>
                      <td className="num px-5 py-2.5">{fmt(a.lastCount)}</td>
                      <td className="px-5 py-2.5">{fmtDate(a.lastCountAt)}</td>
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
