import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { Card, CardHeader, PageHeader, PanelChip, fmt, fmtDate } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { BrandSettingsForm, type BrandRow } from './brand-form';

export const metadata: Metadata = { title: 'Brands & settings' };

export default async function BrandsPage() {
  const { brands } = await api<{ brands: (BrandRow & { permissions: string[] })[] }>('/brands');
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Brands & settings"
        description="One shared panel database serves all three brands; the brand is the origin hostname stored on every record. These settings are per brand. Points value, minimum redemption and the four-eyes amount are money settings that only a Super Admin can change, and every change needs a reason."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {brands.map((b) => (
          <Card key={b.panel}>
            <CardHeader
              title={
                <span className="flex items-center gap-2.5">
                  <BrandLogo panel={b.panel} size={36} />
                  {b.displayName}
                </span>
              }
              hint={<span>Updated {fmtDate(b.updatedAt)}</span>}
              action={<PanelChip panel={b.panel} />}
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-[13px]">
              <dt className="text-fg-3">Origins</dt>
              <dd className="font-mono text-[12px]">{b.origins.join(', ')}</dd>
              <dt className="text-fg-3">Languages</dt>
              <dd>{b.languages.join(', ')}</dd>
              <dt className="text-fg-3">Points value</dt>
              <dd>
                {fmt(b.pointsPerCurrencyUnit)} points = 1 {b.currency}
              </dd>
              <dt className="text-fg-3">Minimum redemption</dt>
              <dd>{fmt(b.minRedemptionPoints)} points</dd>
              <dt className="text-fg-3">Second admin needed above</dt>
              <dd>{fmt(b.fourEyesPoints)} points</dd>
              <dt className="text-fg-3">Profile re-check</dt>
              <dd>every {b.profileReviewMonths} months</dd>
              <dt className="text-fg-3">Archive after</dt>
              <dd>{b.archiveAfterMonths} months without activity</dd>
            </dl>
            {b.permissions.includes('brands.manage') ? (
              <BrandSettingsForm brand={b} canMoney={b.permissions.includes('switches.flip')} />
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
