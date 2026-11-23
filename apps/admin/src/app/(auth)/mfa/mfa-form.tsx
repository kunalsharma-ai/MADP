'use client';

import { useActionState } from 'react';
import { confirmMfa } from '../../actions';
import { btn, input } from '@/components/ui';

export function MfaForm() {
  const [state, action, pending] = useActionState(confirmMfa, {});
  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">Code from the app</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className={input}
        />
      </label>
      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}
      <button disabled={pending} className={`${btn.primary} w-full justify-center`}>
        {pending ? 'Checking…' : 'Turn on MFA and continue'}
      </button>
    </form>
  );
}
