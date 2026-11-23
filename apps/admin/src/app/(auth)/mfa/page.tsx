import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { MfaForm } from './mfa-form';

export const metadata: Metadata = { title: 'Set up MFA' };
export const dynamic = 'force-dynamic';

export default async function MfaPage() {
  const { otpauthUri } = await api<{ otpauthUri: string }>('/auth/mfa/setup', { method: 'POST' });
  const svg = await QRCode.toString(otpauthUri, {
    type: 'svg',
    margin: 1,
    color: { dark: '#0c1426', light: '#ffffff' },
  });
  const secret = new URL(otpauthUri).searchParams.get('secret') ?? '';
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-3">One more step</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Protect your account with an authenticator app
          </h1>
          <p className="mt-1.5 text-sm text-fg-2">
            MADP holds personal and health data, so every staff account uses multi-factor sign-in. Scan the
            code with Google Authenticator, Microsoft Authenticator or 1Password.
          </p>
        </div>
        <div className="flex items-center gap-5 rounded-xl border border-border bg-surface p-4">
          <div
            className="size-36 shrink-0 overflow-hidden rounded-lg bg-white p-1"
            dangerouslySetInnerHTML={{ __html: svg }}
            role="img"
            aria-label="QR code for your authenticator app"
          />
          <div className="min-w-0 text-[13px]">
            <p className="text-fg-3">Can&apos;t scan? Enter this key:</p>
            <p className="mt-1 break-all font-mono text-xs">{secret.replace(/(.{4})/g, '$1 ')}</p>
          </div>
        </div>
        <MfaForm />
      </div>
    </div>
  );
}
