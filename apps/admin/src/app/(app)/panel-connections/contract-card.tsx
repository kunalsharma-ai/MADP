'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FileCheck2, ShieldCheck } from 'lucide-react';
import type { PanelConnectionView } from '@madp/contracts';
import { Badge, btn, fmtDate } from '@/components/ui';
import { unwrap } from '@/lib/result';
import { checkContractAction, runConformanceAction } from './actions';

const STATUS_TONE = { pass: 'teal', fail: 'danger', warn: 'warn', skip: 'neutral' } as const;

/**
 * The MADP Panel API Contract for one panel: which contract version and capabilities it declared, and the last
 * conformance run. MADP calls only the capabilities shown here.
 */
export function ContractCard({ connection: c }: { connection: PanelConnectionView }) {
  const [pending, start] = useTransition();
  const [showChecks, setShowChecks] = useState(false);
  const k = c.contract;
  const sync = k.capabilities.filter((x) => !x.startsWith('admin.'));
  const admin = k.capabilities.filter((x) => x.startsWith('admin.'));
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });

  return (
    <div className="border-t border-border px-5 py-4 text-[12.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
          <FileCheck2 className="size-4 text-accent" aria-hidden /> API contract
        </p>
        {k.source === 'discovered' ? (
          <Badge tone="teal">Contract {k.version}</Badge>
        ) : (
          <Badge tone="warn">Not checked: assumes the shared backend</Badge>
        )}
      </div>
      <p className="mt-1 text-fg-2">
        {k.source === 'discovered'
          ? `The panel declared ${k.capabilities.length} capabilities${k.implementation ? ` (${k.implementation})` : ''}. MADP calls only these.`
          : 'Until the panel answers “Check contract”, MADP assumes the shared T2O/MFR/MHO backend and its capabilities.'}
      </p>
      {k.lastCheck ? (
        <p className={`mt-1 ${k.lastCheck.ok ? 'text-teal' : 'text-danger'}`}>
          Last check {fmtDate(k.lastCheck.at)}: {k.lastCheck.message}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1">
        {sync.map((x) => (
          <Badge key={x}>{x}</Badge>
        ))}
        {admin.map((x) => (
          <Badge key={x} tone="accent">
            {x.replace(/^admin\./, '')}
          </Badge>
        ))}
      </div>
      {k.conformance ? (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
            <ShieldCheck
              className={`size-4 ${k.conformance.conformant ? 'text-teal' : 'text-danger'}`}
              aria-hidden
            />
            {k.conformance.conformant ? 'Conformant' : 'Not conformant'}
            <span className="font-normal text-fg-3">
              {k.conformance.counts.pass} passed · {k.conformance.counts.fail} failed ·{' '}
              {k.conformance.counts.warn} warnings · {k.conformance.counts.skip} skipped ·{' '}
              {fmtDate(k.conformance.at)}
            </span>
          </p>
          {!k.conformance.personalDataProbed ? (
            <p className="mt-0.5 text-fg-3">
              Routes with member data were skipped: live sync is not approved for this panel.
            </p>
          ) : null}
          <button
            className="mt-1 text-[12px] text-accent underline"
            onClick={() => setShowChecks(!showChecks)}
          >
            {showChecks ? 'Hide the checks' : 'Show the checks'}
          </button>
          {showChecks ? (
            <ul className="mt-2 grid max-h-72 gap-1 overflow-y-auto pr-1">
              {k.conformance.results.map((r) => (
                <li key={r.id} className="flex min-w-0 items-start gap-2">
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-fg">{r.title}</span>{' '}
                    <span className="text-fg-3">{r.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {c.canChange ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={btn.secondary}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await unwrap(checkContractAction(c.panel));
                (r.ok ? toast.success : toast.error)(r.message);
              })
            }
          >
            Check contract
          </button>
          <button
            className={btn.secondary}
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await unwrap(runConformanceAction(c.panel));
                (r.conformant ? toast.success : toast.error)(
                  `${r.conformant ? 'Conformant' : 'Not conformant'}: ${r.counts.pass} passed, ${r.counts.fail} failed`,
                );
              })
            }
          >
            Run conformance
          </button>
        </div>
      ) : null}
    </div>
  );
}
