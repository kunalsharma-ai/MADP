'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { NetworkUploadResult } from '@madp/contracts';
import { btn, input } from '@/components/ui';
import { unwrap } from '@/lib/result';
import { newPushKeyAction, revokePushKeyAction, uploadAction } from './actions';

const KINDS = [
  { value: 'members', label: 'Members' },
  { value: 'questions', label: 'Questions' },
  { value: 'answers', label: 'Answers' },
];

async function toBase64(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Check a file first (nothing is saved), then import it. A file with any bad row is not imported. */
export function UploadForm({ panel }: { panel: string }) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState('members');
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [report, setReport] = useState<NetworkUploadResult | null>(null);
  const go = (dryRun: boolean) =>
    start(async () => {
      if (!file) return void toast.error('Pick a file first');
      if (file.size > 24 * 1024 * 1024) return void toast.error('Files up to 24 MB; split larger ones');
      try {
        const format = /\.xlsx$/i.test(file.name) ? 'xlsx' : 'csv';
        const r = await unwrap(uploadAction(panel, { kind, format, file: await toBase64(file), dryRun, reason }));
        setReport(r);
        if (!dryRun) toast.success(`${r.accepted} rows saved. The next sync brings them into MADP.`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return (
    <div className="grid gap-3 text-[13px]">
      <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
        <label className="grid gap-1">
          <span className="text-fg-2">What the file holds</span>
          <select className={input} value={kind} onChange={(e) => (setKind(e.target.value), setReport(null))}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-fg-2">File (.csv or .xlsx, first sheet)</span>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv"
            className={input}
            onChange={(e) => (setFile(e.target.files?.[0] ?? null), setReport(null))}
          />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-fg-2">Reason (kept in the audit log)</span>
        <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={btn.secondary} disabled={pending || !file || reason.trim().length < 5} onClick={() => go(true)}>
          Check the file
        </button>
        <button
          className={btn.primary}
          disabled={pending || !report || !report.dryRun || report.problems.length > 0 || report.accepted === 0}
          onClick={() => go(false)}
        >
          Import {report?.dryRun ? `${report.accepted} rows` : ''}
        </button>
        <a className={btn.ghost} href={`/networks/template/${kind}`}>
          Download a {kind} template
        </a>
      </div>
      {report ? (
        <div className="rounded-lg border border-border p-3">
          <p>
            {report.dryRun ? 'Check: ' : 'Saved: '}
            {report.rows} rows, {report.accepted} ready
            {report.problems.length ? `, ${report.problems.length}${report.problems.length >= 50 ? '+' : ''} with problems` : ''}.
            {report.dryRun && !report.problems.length ? ' Nothing has been saved yet.' : ''}
          </p>
          <p className="mt-1 text-[12px] text-fg-3">
            Columns:{' '}
            {report.columns.map((c) => `${c.column} → ${c.field ?? 'ignored'}`).join(' · ') || 'none'}
          </p>
          {report.problems.length ? (
            <ul className="mt-2 list-disc pl-5 text-[12px] text-danger">
              {report.problems.slice(0, 20).map((p) => (
                <li key={p.row}>
                  Row {p.row}: {p.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Make, replace or remove the key the network signs its pushes with. Shown once. */
export function PushKey({ panel, set, hint }: { panel: string; set: boolean; hint: string | null }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<null | 'new' | 'revoke'>(null);
  const [shown, setShown] = useState<string | null>(null);
  if (shown)
    return (
      <div className="grid gap-2 rounded-lg border border-warn bg-warn-soft p-3 text-[13px]">
        <p className="font-medium">Copy this key now. It won&apos;t be shown again.</p>
        <code className="break-all font-mono text-[12px]">{shown}</code>
        <p className="text-[12px] text-fg-2">Give it to the network&apos;s developer through a safe channel, not e-mail.</p>
        <button className={btn.secondary} onClick={() => setShown(null)}>
          I have copied it
        </button>
      </div>
    );
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span>{set ? <>Push key set ({hint})</> : 'No push key: pushes are off'}</span>
        <button className={btn.secondary} onClick={() => setOpen('new')}>
          {set ? 'Replace key' : 'Make a push key'}
        </button>
        {set ? (
          <button className={btn.ghost + ' text-danger'} onClick={() => setOpen('revoke')}>
            Remove key
          </button>
        ) : null}
      </div>
    );
  return (
    <form
      className="grid gap-2 text-[13px] sm:grid-cols-[1fr_10rem_auto]"
      action={(f) =>
        start(async () => {
          const body = { reason: String(f.get('reason') ?? '').trim(), code: String(f.get('code') ?? '').trim() };
          try {
            if (open === 'new') setShown((await unwrap(newPushKeyAction(panel, body))).key);
            else {
              await unwrap(revokePushKeyAction(panel, body));
              toast.success('Push key removed. Pushes are off.');
            }
            setOpen(null);
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      <input name="reason" required minLength={5} maxLength={500} placeholder="Reason (kept in the audit log)" className={input} />
      <input
        name="code"
        required
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        placeholder="Authenticator code"
        className={input}
      />
      <div className="flex gap-2">
        <button className={open === 'new' ? btn.primary : btn.secondary + ' text-danger'} disabled={pending}>
          {open === 'new' ? (set ? 'Replace' : 'Make key') : 'Remove'}
        </button>
        <button type="button" className={btn.ghost} onClick={() => setOpen(null)}>
          Cancel
        </button>
      </div>
      {open === 'new' && set ? (
        <p className="text-[12px] text-warn sm:col-span-3">The current key stops working as soon as the new one is made.</p>
      ) : null}
    </form>
  );
}
