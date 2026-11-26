import type { Metadata } from 'next';
import type { AudienceSegmentInfo, SegmentRuleInfo, SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { getPanels } from '@/lib/panels';
import { Badge, Card, CardHeader, PageHeader, PanelChip, Table } from '@/components/ui';
import { AddRule, CreateSegment, RuleActions, SegmentActions } from './segment-forms';

export const metadata: Metadata = { title: 'Audience segments' };

type Row = AudienceSegmentInfo & { hasMembers: boolean };

export default async function AudienceSegmentsPage() {
  const [{ segments, rules }, me, panels] = await Promise.all([
    api<{ segments: Row[]; rules: SegmentRuleInfo[] }>('/audience-segments'),
    api<SessionUser>('/auth/me'),
    getPanels(),
  ]);
  const canEdit = me.grants.some((g) => g.role === 'super_admin' && g.brands === null);
  const label = Object.fromEntries(segments.map((s) => [s.key, s.label]));
  const panelName = Object.fromEntries(panels.map((p) => [p.code, p.shortName]));
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Audience segments"
        description={
          <>
            MADP&apos;s own segments, used in audience counts, filters, Supply360 and campaigns across all panels. A
            person can be in several. Each panel stores its own category on a member (for example b2c, b2b or minor);
            the rules below say which segment each value joins, and sync applies them to new and updated members.
            Archiving a segment hides it from filters and stops new members joining; nothing is deleted, and Restore
            brings it back. A segment can be deleted only while it has no members. The built-in six can be renamed
            and archived but not deleted, and Teens always stays a minors segment. The sign-up segments inside each
            panel are set on Segments &amp; audiences.
          </>
        }
      />
      {canEdit ? (
        <div className="mb-4">
          <CreateSegment />
        </div>
      ) : null}
      <Card className="mb-4">
        <CardHeader title={`${segments.length} segments`} hint="Only a Super Admin on every brand changes segments." />
        <Table head={['Segment', 'Key', 'About', 'Status', '']}>
          {segments.map((s) => (
            <tr key={s.key} className="align-top">
              <td className="px-5 py-3 font-medium">
                {s.label}
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.builtIn ? <Badge>Built in</Badge> : null}
                  {s.minors ? <Badge tone="warn">Minors</Badge> : null}
                </div>
              </td>
              <td className="px-5 py-3 font-mono text-[12px]">{s.key}</td>
              <td className="px-5 py-3 text-fg-2">
                {s.description || '—'}
                <div className="text-[11px] text-fg-3">{s.hasMembers ? 'Has members' : 'No members yet'}</div>
              </td>
              <td className="px-5 py-3">
                {s.status === 'archived' ? <Badge tone="warn">Archived</Badge> : <Badge tone="teal">Active</Badge>}
              </td>
              <td className="px-5 py-3">{canEdit ? <SegmentActions segment={s} hasMembers={s.hasMembers} /> : null}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card>
        <CardHeader
          title="Rules: panel category to segment"
          hint="A value can join several segments; a minor joins its adult segment and Teens. Rules of archived segments don't apply."
          action={canEdit ? <AddRule segments={segments.filter((s) => s.status === 'active')} /> : undefined}
        />
        <Table head={['Panel', 'Panel value', 'Joins', 'Minor', 'Where it comes from', 'Status', '']}>
          {rules.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-5 py-3">
                <PanelChip panel={r.panel} label={panelName[r.panel]} />
              </td>
              <td className="px-5 py-3 font-mono text-[12px]">{r.sourceValue}</td>
              <td className="px-5 py-3">{label[r.segment] ?? r.segment}</td>
              <td className="px-5 py-3">{r.minor ? 'Yes' : 'No'}</td>
              <td className="px-5 py-3 text-[12px] text-fg-3">{r.evidence || '—'}</td>
              <td className="px-5 py-3">
                {r.status === 'archived' ? <Badge tone="warn">Archived</Badge> : <Badge tone="teal">Active</Badge>}
              </td>
              <td className="px-5 py-3">{canEdit ? <RuleActions rule={r} /> : null}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
