import type { Metadata } from 'next';
import type { NetworkStatus, SessionUser } from '@madp/contracts';
import { NETWORK_FILE_COLUMNS } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, fmtDate } from '@/components/ui';
import { PushKey, UploadForm } from './network-forms';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Networks' };

export default async function NetworksPage() {
  const [{ networks }, me] = await Promise.all([
    api<{ networks: NetworkStatus[] }>('/networks'),
    api<SessionUser>('/auth/me'),
  ]);
  const canEdit = me.grants.some((g) => g.role === 'super_admin' && g.brands === null);
  return (
    <>
      <PageHeader
        eyebrow="Connectors"
        title="Networks"
        description={
          <>
            Bring in a panel network that runs on other software, without a developer on our side. Add it on
            Panels as &ldquo;another network&rdquo;, approve live sync on Panel connections, then send its
            data here in one of two ways: upload a CSV or Excel file (members, questions or answers), or let
            the network&apos;s own system push data to MADP&apos;s signed push API. Both go into an encrypted
            inbox, and the normal sync reads it, so duplicate matching, consent, minor rules, segments and the
            audit log work exactly as for T2O, MFR and MHO. Always check a file first: nothing is saved until
            every row is valid. Only a Super Admin on every brand sends data, and each upload is kept in the
            audit log by its row count, never its contents.
          </>
        }
      />
      {networks.length === 0 ? (
        <Card>
          <EmptyState title="No networks yet">
            On Panels, press Add a panel and choose &ldquo;It is another network on different software&rdquo;.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4">
          {networks.map((n) => (
            <Card key={n.panel}>
              <CardHeader
                title={n.name}
                hint={
                  <span>
                    Inbox: {n.inbox.members} member, {n.inbox.questions} question, {n.inbox.answers} answer
                    and {n.inbox.deletions} deletion records
                  </span>
                }
                action={
                  n.liveApproved ? (
                    <Badge tone="teal">Live sync approved</Badge>
                  ) : (
                    <Badge tone="warn">Approve live sync on Panel connections first</Badge>
                  )
                }
              />
              <div className="grid gap-5 px-5 py-4">
                {canEdit && n.liveApproved ? (
                  <section className="grid gap-2">
                    <h3 className="text-sm font-medium">Upload a file</h3>
                    <UploadForm panel={n.panel} />
                  </section>
                ) : null}
                {canEdit ? (
                  <section className="grid gap-2">
                    <h3 className="text-sm font-medium">Push API</h3>
                    <p className="text-[12px] text-fg-3">
                      The network&apos;s system sends{' '}
                      <code className="font-mono">POST /api/v1/networks/{n.panel}/push</code> with a JSON body
                      of <code className="font-mono">members</code>,{' '}
                      <code className="font-mono">questions</code>, <code className="font-mono">answers</code>{' '}
                      and <code className="font-mono">deletions</code>. Headers:{' '}
                      <code className="font-mono">x-madp-batch</code> (a unique id, so a retry is never stored
                      twice), <code className="font-mono">x-madp-timestamp</code> (Unix seconds) and{' '}
                      <code className="font-mono">
                        x-madp-signature: v1=&lt;HMAC-SHA256 of &quot;timestamp.batch.body&quot; with the push
                        key&gt;
                      </code>
                      . The fields are the same as the file columns below.
                    </p>
                    <PushKey panel={n.panel} set={n.pushKey.set} hint={n.pushKey.hint} />
                  </section>
                ) : null}
                <section className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">Recent uploads and pushes</h3>
                    {n.batches.length ? (
                      <DownloadMenu
                        screen="networks"
                        title={`${n.name}: uploads and pushes`}
                        columns={[
                          { key: 'batch', label: 'Batch' },
                          { key: 'from', label: 'From' },
                          { key: 'kind', label: 'Holds' },
                          { key: 'records', label: 'Records', type: 'number' },
                          { key: 'at', label: 'Received', type: 'date' },
                        ]}
                        rows={n.batches.map((b) => ({
                          batch: b.batch,
                          from: b.source === 'push' ? 'Push API' : 'Upload',
                          kind: b.kind,
                          records: b.records,
                          at: b.receivedAt,
                        }))}
                      />
                    ) : null}
                  </div>
                  {n.batches.length ? (
                    <Table head={['Batch', 'From', 'Holds', 'Records', 'Received']}>
                      {n.batches.map((b) => (
                        <tr key={b.batch}>
                          <td className="px-5 py-2 font-mono text-[12px]">{b.batch}</td>
                          <td className="px-5 py-2">{b.source === 'push' ? 'Push API' : 'Upload'}</td>
                          <td className="px-5 py-2">{b.kind}</td>
                          <td className="px-5 py-2">{b.records}</td>
                          <td className="px-5 py-2">{fmtDate(b.receivedAt)}</td>
                        </tr>
                      ))}
                    </Table>
                  ) : (
                    <p className="text-[13px] text-fg-3">Nothing received yet.</p>
                  )}
                </section>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Card className="mt-4">
        <CardHeader
          title="File columns"
          hint="Header names are matched without regard to case, spaces, - or _. Other columns are ignored."
        />
        <div className="grid gap-4 px-5 py-4 text-[13px] md:grid-cols-3">
          {(Object.keys(NETWORK_FILE_COLUMNS) as (keyof typeof NETWORK_FILE_COLUMNS)[]).map((k) => (
            <div key={k}>
              <h4 className="mb-1 font-medium capitalize">{k}</h4>
              <ul className="grid gap-0.5">
                {NETWORK_FILE_COLUMNS[k].map((c) => (
                  <li key={c.field}>
                    <code className="font-mono text-[12px]">{c.aliases[0] ?? c.field}</code>
                    {c.required ? <span className="text-danger"> *</span> : null}{' '}
                    <span className="text-fg-3">{c.help}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
