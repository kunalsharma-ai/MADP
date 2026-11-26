'use client';

import type { PanelInfo } from '@madp/contracts';
import { usePanels } from '@/components/panels-context';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createAdminAction, saveRoleAction, updateAdminAction } from '@/app/super-admin-actions';
import { Badge, Card, CardHeader, btn, input } from '@/components/ui';

type Grant = { role: string; brands: string[] | null };

/**
 * All brands ticked (or none) is saved as "every brand". The exception: when a sensitive panel added in the console
 * is ticked, the brands are saved by name, because an all-brands grant doesn't open that panel's health data.
 */
function readGrant(f: FormData, panels: PanelInfo[]): Grant {
  const brands = f.getAll('brands').map(String);
  const named = panels.some((p) => p.sensitive && !p.builtIn && brands.includes(p.code));
  return {
    role: String(f.get('role')),
    brands: brands.length === 0 || (brands.length === panels.length && !named) ? null : brands,
  };
}

function GrantFields({ roles }: { roles: { key: string; name: string }[] }) {
  const panels = usePanels();
  return (
    <>
      <label className="text-[13px]">
        Role
        <select name="role" className={input} required>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="text-[13px]">
        <legend className="mb-1">Brands (all ticked = every brand, including panels added later)</legend>
        <div className="flex flex-wrap gap-3">
          {panels.map((b) => (
            <label key={b.code} className="flex items-center gap-1">
              <input type="checkbox" name="brands" value={b.code} defaultChecked /> {b.shortName}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export function CreateAdmin({ roles }: { roles: { key: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [issued, setIssued] = useState<{ email: string; oneTimePassword: string } | null>(null);
  const panelList = usePanels();
  return (
    <Card>
      <CardHeader
        title="New admin"
        hint="They get a one-time password and must set up an authenticator app at first sign-in."
      />
      <form
        className="grid gap-3 px-5 py-4"
        action={(f) =>
          start(async () => {
            try {
              const email = String(f.get('email'));
              const r = await createAdminAction({
                email,
                displayName: String(f.get('displayName')),
                grants: [readGrant(f, panelList)],
              });
              setIssued({ email, oneTimePassword: r.oneTimePassword });
              toast.success('Admin created');
            } catch (e) {
              toast.error((e as Error).message);
            }
          })
        }
      >
        <label className="text-[13px]">
          Name
          <input name="displayName" required minLength={2} className={input} />
        </label>
        <label className="text-[13px]">
          Work e-mail
          <input name="email" type="email" required className={input} />
        </label>
        <GrantFields roles={roles} />
        <button className={btn.primary} disabled={pending}>
          Create admin
        </button>
      </form>
      {issued ? (
        <div
          className="mx-5 mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px]"
          role="status"
        >
          <p className="font-medium">
            Give this one-time password to {issued.email} in person or by phone. It is not shown again.
          </p>
          <code className="mt-1 block break-all font-mono">{issued.oneTimePassword}</code>
          <button className={`${btn.ghost} mt-1`} onClick={() => setIssued(null)}>
            Done
          </button>
        </div>
      ) : null}
    </Card>
  );
}

export function AdminRowActions({
  id,
  isActive,
  grants,
  roles,
}: {
  id: string;
  isActive: boolean;
  grants: Grant[];
  roles: { key: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const panelList = usePanels();
  const [open, setOpen] = useState(false);
  const run = (input: { isActive?: boolean; grants?: Grant[] }) => {
    const reason = window.prompt('Reason for this change (kept in the audit log)');
    if (!reason) return;
    start(async () => {
      try {
        await updateAdminAction(id, { ...input, reason });
        toast.success('Saved');
        setOpen(false);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <button className={btn.ghost} disabled={pending} onClick={() => setOpen((o) => !o)}>
          Roles
        </button>
        <button className={btn.ghost} disabled={pending} onClick={() => run({ isActive: !isActive })}>
          {isActive ? 'Disable' : 'Enable'}
        </button>
      </div>
      {open ? (
        <form
          className="grid w-64 gap-2 rounded-lg border border-border p-3"
          action={(f) =>
            run({ grants: [...grants.filter((g) => g.role !== String(f.get('role'))), readGrant(f, panelList)] })
          }
        >
          <p className="text-[12px] text-fg-3">
            Add or replace one role. Remove a role by granting the others again.
          </p>
          <GrantFields roles={roles} />
          <button className={btn.secondary} disabled={pending}>
            Save role
          </button>
          {grants.length > 1
            ? grants.map((g) => (
                <button
                  type="button"
                  key={g.role}
                  className={btn.ghost}
                  onClick={() => run({ grants: grants.filter((x) => x.role !== g.role) })}
                >
                  Remove {g.role}
                </button>
              ))
            : null}
        </form>
      ) : null}
    </div>
  );
}

export function RoleEditor({
  role,
  allPermissions,
}: {
  role: {
    key: string;
    name: string;
    description: string;
    permissions: string[];
    system: boolean;
    holders: number;
  } | null;
  allPermissions: string[];
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const locked = role?.key === 'super_admin';
  return (
    <Card>
      <CardHeader
        title={role ? role.name : 'New role'}
        hint={
          role ? (
            <span>
              <code className="font-mono">{role.key}</code> · {role.holders} admins{' '}
              {role.system ? <Badge>built-in</Badge> : null}
            </span>
          ) : (
            'Made without code: pick a key, a name and its permissions.'
          )
        }
        action={
          locked ? null : (
            <button className={btn.ghost} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Close' : role ? 'Edit' : 'Create'}
            </button>
          )
        }
      />
      {role && !editing ? (
        <div className="px-5 pb-4 text-[12px]">
          <p className="mb-2 text-fg-2">{role.description}</p>
          <p className="font-mono text-[11px] leading-5 text-fg-3">{role.permissions.join(' · ')}</p>
        </div>
      ) : null}
      {editing ? (
        <form
          className="grid gap-3 px-5 pb-4"
          action={(f) =>
            start(async () => {
              try {
                const reason = role ? String(f.get('reason') ?? '') : undefined;
                await saveRoleAction(
                  role?.key ?? String(f.get('key')),
                  {
                    name: String(f.get('name')),
                    description: String(f.get('description') ?? ''),
                    permissions: f.getAll('permissions').map(String),
                    ...(reason ? { reason } : {}),
                  },
                  !role,
                );
                toast.success('Role saved');
                setEditing(false);
              } catch (e) {
                toast.error((e as Error).message);
              }
            })
          }
        >
          {!role ? (
            <label className="text-[13px]">
              Key (lower case)
              <input
                name="key"
                required
                pattern="[a-z][a-z0-9_]{1,47}"
                className={input}
                placeholder="mho_verifier"
              />
            </label>
          ) : null}
          <label className="text-[13px]">
            Name
            <input name="name" required minLength={2} defaultValue={role?.name} className={input} />
          </label>
          <label className="text-[13px]">
            Description
            <input name="description" defaultValue={role?.description} className={input} />
          </label>
          <fieldset className="text-[12px]">
            <legend className="mb-1">Permissions</legend>
            <div className="grid max-h-64 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto font-mono">
              {allPermissions.map((p) => (
                <label key={p} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={p}
                    defaultChecked={role?.permissions.includes(p)}
                  />{' '}
                  {p}
                </label>
              ))}
            </div>
          </fieldset>
          {role ? (
            <label className="text-[13px]">
              Reason
              <input name="reason" required minLength={5} className={input} />
            </label>
          ) : null}
          <button className={btn.primary} disabled={pending}>
            Save
          </button>
        </form>
      ) : null}
    </Card>
  );
}
