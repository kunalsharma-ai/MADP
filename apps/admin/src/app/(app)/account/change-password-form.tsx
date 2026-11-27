'use client';

import { useRef, useTransition } from 'react';
import { toast } from 'sonner';
import { changePasswordAction } from '@/app/super-admin-actions';
import { btn, input } from '@/components/ui';

export function ChangePasswordForm() {
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="grid gap-3 px-5 py-4"
      action={(f) =>
        start(async () => {
          const next = String(f.get('newPassword') ?? '');
          if (next !== String(f.get('confirm') ?? '')) {
            toast.error('The two new passwords are not the same');
            return;
          }
          const r = await changePasswordAction({
            currentPassword: String(f.get('currentPassword') ?? ''),
            newPassword: next,
          });
          if (r.error) toast.error(r.error);
          else {
            toast.success('Password changed');
            form.current?.reset();
          }
        })
      }
    >
      <label className="text-[13px]">
        Current password
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={input}
        />
      </label>
      <label className="text-[13px]">
        New password
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={200}
          className={input}
        />
      </label>
      <label className="text-[13px]">
        New password again
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={200}
          className={input}
        />
      </label>
      <button className={btn.primary} disabled={pending}>
        {pending ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
