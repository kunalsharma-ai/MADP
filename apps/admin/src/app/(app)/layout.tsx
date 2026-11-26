import { redirect } from 'next/navigation';
import type { SessionUser } from '@madp/contracts';
import { api, ApiError, currentBrand } from '@/lib/api';
import { Shell } from '@/components/shell';
import { getPanels } from '@/lib/panels';
import { signOut } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user: SessionUser;
  try {
    user = await api<SessionUser>('/auth/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) redirect('/mfa');
    throw e;
  }
  if (user.brands.length === 0) redirect('/mfa');
  const allowAll = user.permissions.includes('dashboard.read');
  const brand = (await currentBrand()) ?? user.brands[0]!;
  const panels = await getPanels();
  return (
    <Shell user={user} signOut={signOut} brand={brand} allowAll={allowAll} panels={panels}>
      {children}
    </Shell>
  );
}
