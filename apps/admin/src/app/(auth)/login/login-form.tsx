'use client';

import { useActionState } from 'react';
import { signIn } from '../../actions';
import { btn, input } from '@/components/ui';

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} className="w-full max-w-sm space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-fg-3">Use your MADP staff account.</p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">Work e-mail</span>
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">Authenticator code</span>
        <input
          name="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="6 digits, once MFA is set up"
          className={input}
        />
      </label>
      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${btn.primary} w-full justify-center`}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <details className="text-[13px] text-fg-3">
        <summary className="cursor-pointer text-accent hover:underline">
          Forgot your password or lost your phone?
        </summary>
        <p className="mt-1.5">
          Ask a Super Admin to reset it on Admins &amp; roles. You get a new one-time password, and they can
          also reset two-factor so you set up the authenticator again. If no Super Admin can sign in, the
          server team can run <code className="font-mono">reset-admin-password</code> (see the runbook).
        </p>
      </details>
    </form>
  );
}
