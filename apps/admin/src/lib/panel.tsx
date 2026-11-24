import 'server-only';
import type { ReactNode } from 'react';
import { ApiError, currentBrand } from '@/lib/api';
import { Card, EmptyState } from '@/components/ui';

/**
 * Members, question bank and profiles work in one brand at a time. Renders a prompt when "All brands" is picked, and
 * a clear message when the brand's panel admin API is not connected yet, instead of an error page.
 */
export async function withPanel(
  render: (brand: 't2o' | 'mfr' | 'mho') => Promise<ReactNode>,
): Promise<ReactNode> {
  const brand = await currentBrand();
  if (!brand || brand === 'all')
    return (
      <Card>
        <EmptyState title="Pick a brand">
          Members, the question bank and profiles are managed one brand at a time. Choose T2O, MFR or MHO in
          the brand switcher at the top.
        </EmptyState>
      </Card>
    );
  try {
    return await render(brand as 't2o' | 'mfr' | 'mho');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 503 || e.status === 502))
      return (
        <Card>
          <EmptyState title={`${brand.toUpperCase()} is not connected yet`}>
            {e.message} The panel side is built (MFR #44); it needs the shared secret and the panel&apos;s
            address in this environment, which is a deploy step for Kunal to approve.
          </EmptyState>
        </Card>
      );
    // A panel answers 404 to its whole admin API until MADP_ADMIN_API_SECRETS is set, and to a record that is gone.
    if (e instanceof ApiError && e.status === 404)
      return (
        <Card>
          <EmptyState title={`${brand.toUpperCase()} answered “not found”`}>
            Either the record was removed, or the panel&apos;s admin API is
            switched off: it answers this to every request until MADP&apos;s shared secret is set on the panel
            (MADP_ADMIN_API_SECRETS), which is a deploy step for Kunal to approve.
          </EmptyState>
        </Card>
      );
    if (e instanceof ApiError && e.status === 403)
      return (
        <Card>
          <EmptyState title="Not permitted">{e.message}</EmptyState>
        </Card>
      );
    throw e;
  }
}
