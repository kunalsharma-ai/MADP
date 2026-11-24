import { PANEL_CODES, type PanelCode, type Permission, type RoleGrant } from '@madp/contracts';

export interface Access {
  permissions: Permission[];
  brandPermissions: Partial<Record<PanelCode, Permission[]>>;
  brands: PanelCode[];
}

/**
 * Works out what an admin may do from their role grants. A grant with `brands: null` covers every brand.
 * `permissions` is the intersection over all brands, so a cross-brand screen only opens for someone who may see every
 * brand's rows; an admin limited to MFR uses brand-scoped routes with the MFR brand picked.
 */
export function computeAccess(
  grants: RoleGrant[],
  rolePermissions: ReadonlyMap<string, readonly Permission[]>,
): Access {
  const per: Record<PanelCode, Set<Permission>> = { t2o: new Set(), mfr: new Set(), mho: new Set() };
  for (const g of grants) {
    const perms = rolePermissions.get(g.role) ?? [];
    for (const b of g.brands ?? PANEL_CODES) for (const p of perms) per[b].add(p);
  }
  const brandPermissions: Partial<Record<PanelCode, Permission[]>> = {};
  const brands: PanelCode[] = [];
  for (const b of PANEL_CODES) {
    if (per[b].size) {
      brandPermissions[b] = [...per[b]].sort();
      brands.push(b);
    }
  }
  const permissions = [...per.t2o].filter((p) => per.mfr.has(p) && per.mho.has(p)).sort();
  return { permissions, brandPermissions, brands };
}

/** True when `holder` has every permission of `wanted` on every brand `wanted` covers (no privilege escalation). */
export function covers(holder: Access, wanted: Access): boolean {
  return PANEL_CODES.every((b) => {
    const need = wanted.brandPermissions[b] ?? [];
    const have = new Set(holder.brandPermissions[b] ?? []);
    return need.every((p) => have.has(p));
  });
}

export function hasOn(
  access: Pick<Access, 'brandPermissions' | 'permissions'>,
  brand: PanelCode | 'all',
  needed: Permission[],
) {
  const have = brand === 'all' ? access.permissions : (access.brandPermissions[brand] ?? []);
  return needed.every((p) => have.includes(p));
}
