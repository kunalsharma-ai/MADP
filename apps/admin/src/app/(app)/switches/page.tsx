import type { Metadata } from 'next';
import type { SwitchBoard, SwitchView } from '@madp/contracts';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, PageHeader, Table, fmtDate } from '@/components/ui';
import { ReasonAction } from '@/components/reason-action';

export const metadata: Metadata = { title: 'Feature switches' };

const GROUPS: { key: SwitchView['group']; title: string; hint: string }[] = [
  { key: 'money', title: 'Money', hint: 'Anything that turns points into value for a member.' },
  { key: 'legal', title: 'Legal', hint: 'Needs legal clearance in each country first.' },
  {
    key: 'email',
    title: 'E-mail and push',
    hint: 'Anything sent to members or the team outside the portal.',
  },
];

function Row({ s, canFlip }: { s: SwitchView; canFlip: boolean }) {
  return (
    <tr>
      <td className="px-5 py-2.5">
        <p className="font-medium">{s.label}</p>
        <p className="font-mono text-[11px] text-fg-3">{s.key}</p>
      </td>
      <td className="px-5 py-2.5">{s.effective ? <Badge tone="teal">On</Badge> : <Badge>Off</Badge>}</td>
      <td className="px-5 py-2.5 text-[12px] text-fg-2">
        {s.set === null ? `Default (${s.default ? 'on' : 'off'})` : s.set ? 'Set on' : 'Set off'}
      </td>
      <td className="max-w-xs px-5 py-2.5 text-[12px] text-fg-2">
        {s.reason ? (
          <>
            <span className="line-clamp-2">{s.reason}</span>
            <span className="text-fg-3">{fmtDate(s.changedAt)}</span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-5 py-2.5">
        {canFlip ? (
          <ReasonAction
            op={{ op: 'switch', key: s.key, on: !(s.set ?? s.default) }}
            label={(s.set ?? s.default) ? 'Turn off' : 'Turn on'}
            done="Switch changed"
            danger={!(s.set ?? s.default)}
          />
        ) : null}
      </td>
    </tr>
  );
}

export default async function SwitchesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Feature switches"
        description="Every money, legal and e-mail feature starts off on every brand. Only Super Admin can change a switch, always with a reason, and every change is in the audit log. The panel checks the switch at the moment it acts, so a change applies within ten seconds."
      />
      {await withPanel(async () => {
        const b = await api<SwitchBoard & { canFlip: boolean }>('/panel/switches');
        return (
          <div className="grid gap-4">
            <Card>
              <CardHeader
                title={b.killed ? 'Everything is stopped on this brand' : 'Stop everything'}
                hint="The kill switch turns every switch below off at once. Each switch keeps its own setting for when the kill switch is turned off again."
                action={
                  b.canFlip ? (
                    <ReasonAction
                      op={{ op: 'switch', key: 'kill', on: !b.killed }}
                      label={b.killed ? 'Turn the kill switch off' : 'Stop everything'}
                      done={b.killed ? 'Kill switch off' : 'Everything stopped'}
                      danger={!b.killed}
                    />
                  ) : (
                    <Badge>{b.killed ? 'Stopped' : 'Running'}</Badge>
                  )
                }
              />
            </Card>
            {!b.canFlip ? (
              <p className="text-[13px] text-fg-3">
                You can see the switches. Only Super Admin can change them.
              </p>
            ) : null}
            {GROUPS.map((g) => (
              <Card key={g.key}>
                <CardHeader title={g.title} hint={g.hint} />
                <Table head={['Switch', 'Now', 'Setting', 'Last reason', '']}>
                  {b.switches
                    .filter((s) => s.group === g.key)
                    .map((s) => (
                      <Row
                        key={s.key}
                        s={{ ...s, effective: b.killed ? false : s.effective }}
                        canFlip={b.canFlip}
                      />
                    ))}
                </Table>
              </Card>
            ))}
          </div>
        );
      })}
    </>
  );
}
