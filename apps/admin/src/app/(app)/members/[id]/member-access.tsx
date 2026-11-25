'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  memberAdminSessionsAction,
  memberEmailAction,
  memberEndSessionAction,
  memberLoginAsAction,
  type AdminSessionRow,
  type LoginAsResult,
  type MemberEmailResult,
} from '@/app/panel-actions';
import { Badge, Card, CardHeader, btn, fmtDate, input } from '@/components/ui';

const STATE_TONE = { waiting: 'accent', open: 'warn', unused: 'neutral', expired: 'neutral', ended: 'neutral' } as const;
const time = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/**
 * Account help for one member: e-mail a password reset link, send the welcome again, and log in as the member.
 * E-mails go out only once the brand's "Console e-mails to one member" switch is on; until then the panel answers
 * with what would be sent. The console never sees or sets a password.
 */
export function MemberAccess({
  member,
  segment,
  brand,
  canResendEmail,
  canLoginAs,
}: {
  member: string;
  segment: string;
  brand: string;
  canResendEmail: boolean;
  canLoginAs: boolean;
}) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [mail, setMail] = useState<MemberEmailResult | null>(null);
  const [link, setLink] = useState<LoginAsResult | null>(null);
  const [sessions, setSessions] = useState<AdminSessionRow[] | null>(null);
  const ok = reason.trim().length >= 5;
  const teen = segment === 'teen';

  const load = () =>
    start(async () => {
      const r = await memberAdminSessionsAction(member);
      if (r.ok) setSessions(r.data.items);
    });
  useEffect(() => {
    if (canLoginAs && !teen) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  if (!canResendEmail && !canLoginAs) return null;
  if (teen)
    return (
      <Card>
        <CardHeader title="Account help" />
        <p className="px-5 py-4 text-[13px] text-fg-3">
          Teen accounts get their links through the Teen module. Nobody can sign in as a teen member.
        </p>
      </Card>
    );

  const email = (kind: 'reset-password' | 'resend-welcome') =>
    start(async () => {
      const r = await memberEmailAction(member, kind, reason);
      if (!r.ok) return void toast.error(r.error);
      setMail(r.data);
      toast.success(r.data.sent ? 'E-mail sent' : 'Nothing sent: the e-mail switch is off');
    });

  return (
    <Card>
      <CardHeader
        title="Account help"
        hint="Each action needs a reason and goes into the audit log with your name."
      />
      <div className="grid gap-4 px-5 py-4 text-[13px]">
        <label>
          Reason
          <input
            className={input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example: member phoned, can't sign in"
          />
        </label>
        {canResendEmail ? (
          <div>
            <p className="mb-1.5 text-fg-3">E-mails</p>
            <div className="flex flex-wrap gap-2">
              <button className={btn.secondary} disabled={pending || !ok} onClick={() => email('reset-password')}>
                Send password reset link
              </button>
              <button className={btn.secondary} disabled={pending || !ok} onClick={() => email('resend-welcome')}>
                Send welcome again
              </button>
            </div>
            {mail ? (
              <div className="mt-2 rounded-lg bg-surface-2 p-3">
                <p className="font-medium">{mail.sent ? 'Sent' : 'Not sent: the e-mail switch is off for this brand'}</p>
                <p className="text-fg-2">
                  {mail.wouldSend.subject} · {mail.wouldSend.template} · to {mail.wouldSend.to}
                </p>
                {!mail.sent ? (
                  <p className="mt-1 text-fg-3">
                    A Super Admin can turn on &ldquo;Console e-mails to one member&rdquo; in Feature switches once
                    sending is approved.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {canLoginAs ? (
          <div>
            <p className="mb-1.5 text-fg-3">Log in as member</p>
            <p className="mb-2 text-fg-3">
              A one-use link for a 15-minute session. It can&apos;t change the password, e-mail or payout details, redeem
              rewards or answer for the member{brand === 'mho' ? ', and it shows no health answers' : ''}.
            </p>
            <button
              className={btn.secondary}
              disabled={pending || !ok}
              onClick={() =>
                start(async () => {
                  const r = await memberLoginAsAction(member, reason);
                  if (!r.ok) return void toast.error(r.error);
                  setLink(r.data);
                  load();
                })
              }
            >
              Get sign-in link
            </button>
            {link ? (
              <div className="mt-2 grid gap-1.5 rounded-lg bg-surface-2 p-3">
                <p>
                  Open it by {time(link.redeemBy)}. The session ends at {time(link.expiresAt)}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a className={btn.primary} href={link.url} target="_blank" rel="noreferrer noopener">
                    Open member site
                  </a>
                  <button
                    className={btn.ghost}
                    onClick={() => {
                      void navigator.clipboard?.writeText(link.url);
                      toast.success('Link copied');
                    }}
                  >
                    Copy link
                  </button>
                </div>
              </div>
            ) : null}
            {sessions && sessions.length ? (
              <ul className="mt-3 grid gap-1.5">
                {sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATE_TONE[s.state]}>{s.state}</Badge>
                    <span className="text-fg-2">{fmtDate(s.issuedAt)}</span>
                    <span className="truncate text-fg-3">{s.reason}</span>
                    {s.state === 'waiting' || s.state === 'open' ? (
                      <button
                        className={btn.ghost}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const r = await memberEndSessionAction(member, s.id);
                            if (!r.ok) return void toast.error(r.error);
                            toast.success('Session ended');
                            load();
                          })
                        }
                      >
                        End now
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
