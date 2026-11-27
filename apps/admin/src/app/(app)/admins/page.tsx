import type { Metadata } from 'next';
import type { RoleGrant } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, PageHeader, Table, fmtDate } from '@/components/ui';
import { AdminRowActions, CreateAdmin, RoleEditor } from './admin-forms';
import { DownloadMenu } from '@/components/files';

export const metadata: Metadata = { title: 'Admins & roles' };

interface AdminRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  grants: RoleGrant[];
}
interface RoleRow {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  system: boolean;
  holders: number;
}

const brandText = (b: string[] | null) => (b ? b.map((x) => x.toUpperCase()).join(', ') : 'All brands');

export default async function AdminsPage() {
  const [admins, roles, perms, me] = await Promise.all([
    api<AdminRow[]>('/admins'),
    api<RoleRow[]>('/roles'),
    import('@madp/contracts').then((m) => m.Permission.options as readonly string[]),
    api<{ id: string }>('/auth/me'),
  ]);
  const now = Date.now();
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Admins & roles"
        description="Admin accounts are separate from panel members. A role is a list of permissions, granted brand by brand. Everyone signs in with an authenticator app and is signed out after 30 idle minutes. You can only grant what you hold yourself, and every change is audited with a reason."
      />
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title="Admins"
            hint={`${admins.length} accounts`}
            action={
              <DownloadMenu
                screen="admins"
                title="Admins"
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'email', label: 'E-mail' },
                  { key: 'roles', label: 'Roles and brands' },
                  { key: 'mfa', label: 'Two-factor' },
                  { key: 'last', label: 'Last sign-in', type: 'date' },
                  { key: 'status', label: 'Status' },
                ]}
                rows={admins.map((a) => ({
                  name: a.displayName,
                  email: a.email,
                  roles: a.grants.map((g) => `${g.role} (${brandText(g.brands)})`).join('; '),
                  mfa: a.mfaEnabled ? 'On' : 'Off',
                  last: a.lastLoginAt,
                  status: a.isActive ? 'Active' : 'Disabled',
                }))}
              />
            }
          />
          <Table head={['Admin', 'Roles and brands', 'Two-factor', 'Last sign-in', 'Status', '']}>
            {admins.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="px-5 py-2.5">
                  <p className="text-fg">{a.displayName}</p>
                  <p className="font-mono text-[11px] text-fg-3">{a.email}</p>
                </td>
                <td className="px-5 py-2.5 text-[12px]">
                  {a.grants.map((g) => (
                    <p key={g.role}>
                      {roles.find((r) => r.key === g.role)?.name ?? g.role} ·{' '}
                      <span className="text-fg-3">{brandText(g.brands)}</span>
                    </p>
                  ))}
                </td>
                <td className="px-5 py-2.5">
                  <Badge tone={a.mfaEnabled ? 'teal' : 'warn'}>{a.mfaEnabled ? 'on' : 'not enrolled'}</Badge>
                </td>
                <td className="px-5 py-2.5 whitespace-nowrap">
                  {a.lastLoginAt ? fmtDate(a.lastLoginAt) : '—'}
                </td>
                <td className="px-5 py-2.5">
                  <Badge tone={a.isActive ? 'teal' : 'danger'}>{a.isActive ? 'active' : 'disabled'}</Badge>
                  {a.lockedUntil && new Date(a.lockedUntil).getTime() > now ? (
                    <Badge tone="warn">locked</Badge>
                  ) : null}
                </td>
                <td className="px-5 py-2.5">
                  <AdminRowActions
                    id={a.id}
                    email={a.email}
                    isActive={a.isActive}
                    isSelf={a.id === me.id}
                    grants={a.grants}
                    roles={roles.map((r) => ({ key: r.key, name: r.name }))}
                  />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <CreateAdmin roles={roles.map((r) => ({ key: r.key, name: r.name }))} />
      </div>
      <h2 className="mt-8 mb-3 text-lg font-semibold text-fg">Roles</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => (
          <RoleEditor key={r.key} role={r} allPermissions={[...perms]} />
        ))}
        <RoleEditor role={null} allPermissions={[...perms]} />
      </div>
    </>
  );
}
