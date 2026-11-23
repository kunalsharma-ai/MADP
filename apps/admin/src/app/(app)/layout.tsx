import { redirect } from 'next/navigation';
import type { SessionUser } from '@madp/contracts';
import { api, ApiError } from '@/lib/api';
import { Shell } from '@/components/shell';
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
  if (user.permissions.length === 0) redirect('/mfa');
  return (
    <Shell user={user} signOut={signOut}>
      {children}
    </Shell>
  );
}
