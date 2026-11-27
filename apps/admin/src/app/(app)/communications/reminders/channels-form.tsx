'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, KeyRound, MessageCircle, Plug, Smartphone, XCircle } from 'lucide-react';
import type { ChannelName, ChannelSetup, ChannelsView, ReminderCaseKey } from '@madp/contracts';
import { checkChannelAction, removeChannelAction, saveChannelAction } from '@/app/reminders-actions';
import { TopicInfo } from '@/components/screen-info';
import { Badge, btn, fmtDate, input } from '@/components/ui';

const META: Record<ChannelName, { title: string; icon: typeof Plug; tint: string }> = {
  whatsapp: { title: 'WhatsApp', icon: MessageCircle, tint: '#16a34a' },
  sms: { title: 'SMS', icon: Smartphone, tint: '#0ea5e9' },
};

function Channel({
  channel,
  setup,
  providers,
  cases,
  canEdit,
}: {
  channel: ChannelName;
  setup: ChannelSetup | null;
  providers: ChannelsView['providers'][ChannelName];
  cases: { key: ReminderCaseKey; label: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const first = Object.keys(providers)[0] ?? '';
  const [provider, setProvider] = useState(setup?.provider ?? first);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [sender, setSender] = useState(setup?.sender ?? '');
  const [language, setLanguage] = useState(setup?.language ?? 'en');
  const [templates, setTemplates] = useState<Partial<Record<ReminderCaseKey, string>>>(
    setup?.templates ?? {},
  );
  const [reason, setReason] = useState('');
  const spec = providers[provider];
  const m = META[channel];
  const changingProvider = setup && setup.provider !== provider;

  const save = () =>
    start(async () => {
      const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim()));
      const r = await saveChannelAction(channel, {
        provider: provider as 'twilio' | 'msg91' | 'meta',
        credentials,
        sender,
        templates,
        language,
        reason,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${m.title} provider saved. Press "Check connection" to test the keys.`);
      setCreds({});
      setReason('');
      router.refresh();
    });
  const check = () =>
    start(async () => {
      const r = await checkChannelAction(channel);
      if (!r.ok) return void toast.error(r.error);
      if (r.data.ok) toast.success(r.data.message || 'Connected');
      else toast.error(r.data.message || 'The provider did not accept the keys');
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const r = await removeChannelAction(channel, reason);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${m.title} provider removed. Nothing goes out on ${m.title} now.`);
      setReason('');
      router.refresh();
    });

  return (
    <div className="grid content-start gap-3 rounded-xl border border-border bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="grid size-8 place-items-center rounded-lg text-white"
          style={{ background: m.tint }}
          aria-hidden
        >
          <m.icon className="size-4" />
        </span>
        <h3 className="text-[14px] font-bold">{m.title}</h3>
        {setup ? (
          setup.checkOk === true ? (
            <Badge tone="teal">
              <CheckCircle2 className="mr-1 inline size-3" aria-hidden />
              Connected
            </Badge>
          ) : setup.checkOk === false ? (
            <Badge tone="danger">
              <XCircle className="mr-1 inline size-3" aria-hidden />
              Check failed
            </Badge>
          ) : (
            <Badge>Saved, not checked</Badge>
          )
        ) : (
          <Badge>Not set up</Badge>
        )}
        {setup ? (
          <span className="ml-auto text-[11px] text-fg-3">
            {setup.providerLabel} · key …{setup.keyHint} · {fmtDate(setup.updatedAt)}
          </span>
        ) : null}
      </div>
      {setup?.checkMessage ? (
        <p className="text-[12px] text-fg-2">
          Last check {fmtDate(setup.checkedAt)}: {setup.checkMessage}
        </p>
      ) : null}

      {canEdit ? (
        <div className="grid gap-2 text-[13px] sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-fg-2">Provider</span>
            <select className={input} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {Object.entries(providers).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          {spec?.fields.map((f) => (
            <label key={f.key} className="grid gap-1">
              <span className="flex items-center gap-1 text-fg-2">
                {f.secret ? <KeyRound className="size-3.5" aria-hidden /> : null}
                {f.label}
              </span>
              <input
                className={input}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                value={creds[f.key] ?? ''}
                placeholder={setup && !changingProvider ? 'Saved. Leave empty to keep it' : ''}
                onChange={(e) => setCreds((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="grid gap-1">
            <span className="text-fg-2">{spec?.sender ?? 'Sender'}</span>
            <input className={input} value={sender} onChange={(e) => setSender(e.target.value)} />
          </label>
          {channel === 'whatsapp' ? (
            <label className="grid gap-1">
              <span className="text-fg-2">Template language</span>
              <input
                className={input}
                value={language}
                placeholder="en or en_US"
                onChange={(e) => setLanguage(e.target.value)}
              />
            </label>
          ) : null}
          {spec?.templates ? (
            <details className="sm:col-span-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-accent">
                {spec.templates} for each reminder
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {cases.map((c) => (
                  <label key={c.key} className="grid gap-1">
                    <span className="text-[12px] text-fg-2">{c.label}</span>
                    <input
                      className={input}
                      value={templates[c.key] ?? ''}
                      onChange={(e) => setTemplates((s) => ({ ...s, [c.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-fg-2">Reason (kept in the audit log; keys are never logged)</span>
            <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button
              type="button"
              className={btn.primary}
              disabled={pending || reason.trim().length < 5}
              onClick={save}
            >
              Save
            </button>
            {setup ? (
              <>
                <button type="button" className={btn.secondary} disabled={pending} onClick={check}>
                  Check connection
                </button>
                <button
                  type="button"
                  className={btn.ghost}
                  disabled={pending || reason.trim().length < 5}
                  onClick={remove}
                  title="Needs a reason"
                >
                  Remove
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-fg-3">Setting up a provider needs Brands manage.</p>
      )}
    </div>
  );
}

/**
 * WhatsApp and SMS providers for this brand, entered here by an admin instead of a developer. Keys go to the panel,
 * which stores them encrypted and only ever shows their last four characters. "Check connection" asks the provider
 * whether the keys are good and sends no message.
 */
export function ChannelsForm({
  brand,
  view,
  cases,
  canEdit,
}: {
  brand: string;
  view: ChannelsView;
  cases: { key: ReminderCaseKey; label: string }[];
  canEdit: boolean;
}) {
  return (
    <section
      aria-label="Message channels"
      className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-soft"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Plug className="size-4 text-accent" aria-hidden />
        <h2 className="text-[15px] font-bold">Message channels for {brand.toUpperCase()}</h2>
        <TopicInfo
          title="WhatsApp and SMS providers"
          help={{
            why: 'Members can choose WhatsApp or SMS for their alerts. The panel needs a provider account to send them.',
            where: 'Your Twilio, MSG91 or Meta WhatsApp Cloud API account gives the keys and the sender.',
            how: [
              'Pick the provider, paste the keys and the sender, add a reason and press Save.',
              'Press Check connection. It only asks the provider whether the keys work and sends nothing.',
              'WhatsApp and Indian SMS (DLT) need an approved template per reminder. Add each template name or id.',
              'Messages go out only after Super Admin turns on the WhatsApp or SMS switch.',
            ],
          }}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {view.channels.map((c) => (
          <Channel
            key={c.channel}
            channel={c.channel}
            setup={c.setup}
            providers={view.providers[c.channel]}
            cases={cases}
            canEdit={canEdit}
          />
        ))}
      </div>
    </section>
  );
}
