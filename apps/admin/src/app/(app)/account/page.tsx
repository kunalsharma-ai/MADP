import type { Metadata } from 'next';
import type { SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { Card, CardHeader, PageHeader } from '@/components/ui';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const me = await api<SessionUser>('/auth/me');
  return (
    <>
      <PageHeader
        eyebrow="My account"
        title={me.displayName}
        description={`${me.email} · two-factor ${me.mfaEnabled ? 'on' : 'not set up'}. Forgot your password, or lost your phone? Ask a Super Admin to reset it on Admins & roles.`}
      />
      <div className="max-w-lg">
        <Card>
          <CardHeader
            title="Change password"
            hint="At least 12 characters. Your other sessions are signed out; this one stays."
          />
          <ChangePasswordForm />
        </Card>
      </div>
    </>
  );
}
