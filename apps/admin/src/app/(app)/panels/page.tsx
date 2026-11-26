import type { Metadata } from 'next';
import type { PanelInfo, SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { CreatePanel, PanelActions } from './panel-forms';

export const metadata: Metadata = { title: 'Panels' };

type Row = PanelInfo & { hasData: boolean };

export default async function PanelsPage() {
  const [{ panels }, me] = await Promise.all([
    api<{ panels: Row[] }>('/panels'),
    api<SessionUser>('/auth/me'),
  ]);
  // Only a Super Admin on every brand may change panels; others see the list.
  const canEdit = me.grants.some((g) => g.role === 'super_admin' && g.brands === null);
  return (
    <>
      <PageHeader
        eyebrow="Connectors"
        title="Panels"
        description={
          <>
            The panels (brands) MADP serves. Turn2Opinion, MyFrequentRewards and MyHealthOpinions are built in:
            you can rename them or change their order, but not archive or delete them, and MHO always stays a
            health panel. Add another panel that runs on the shared panel backend here; it starts on DEMO data
            until you set its address and token on Panel connections. Archiving a panel stops its sync and hides
            it from the brand switcher, and nothing is deleted, so Restore brings it back as it was. A panel can
            be deleted only while it holds no data. Only a Super Admin on every brand makes these changes, and
            each one is kept in the audit log with its reason.
          </>
        }
      />
      <p className="mb-4 rounded-xl border border-border bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
        After adding a panel, the shared panel backend must also let MADP manage the new site. When the backend is
        next deployed, add the new site&apos;s hostname to its{' '}
        <code className="font-mono">MADP_ADMIN_API_ORIGINS</code> setting; until then, sync works but admin actions
        (such as approving a reward) for that panel are refused by the backend. See the runbook, &ldquo;Add a
        panel&rdquo;.
      </p>
      {canEdit ? (
        <div className="mb-4">
          <CreatePanel />
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        {panels.map((p) => (
          <Card key={p.code}>
            <CardHeader
              title={
                <span className="flex items-center gap-2.5">
                  <BrandLogo panel={p.code} label={p.shortName} size={36} />
                  {p.name}
                </span>
              }
              hint={<span className="font-mono">{p.code}</span>}
              action={
                <span className="flex flex-wrap items-center gap-1.5">
                  {p.builtIn ? <Badge>Built in</Badge> : null}
                  {p.status === 'archived' ? <Badge tone="warn">Archived</Badge> : <Badge tone="teal">Active</Badge>}
                  {p.sensitive ? <Badge tone="danger">Health data</Badge> : null}
                </span>
              }
            />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-4 text-[13px]">
              <dt className="text-fg-3">Short name</dt>
              <dd>{p.shortName}</dd>
              <dt className="text-fg-3">Website</dt>
              <dd className="min-w-0 break-all">{p.siteUrl ?? '—'}</dd>
              <dt className="text-fg-3">Data from</dt>
              <dd>{p.sourceType === 'inbox' ? 'Uploads and push API (Networks)' : 'Shared panel backend API'}</dd>
              <dt className="text-fg-3">Holds data</dt>
              <dd>{p.hasData ? 'Yes' : 'Not yet'}</dd>
              <dt className="text-fg-3">Order</dt>
              <dd>{p.sort}</dd>
              {p.description ? (
                <>
                  <dt className="text-fg-3">About</dt>
                  <dd className="text-fg-2">{p.description}</dd>
                </>
              ) : null}
            </dl>
            {canEdit ? <PanelActions panel={p} hasData={p.hasData} /> : null}
          </Card>
        ))}
      </div>
    </>
  );
}
