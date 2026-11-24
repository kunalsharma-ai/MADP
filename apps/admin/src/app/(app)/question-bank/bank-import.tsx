'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { importAction, importXlsxAction } from '@/app/panel-actions';
import { Badge, Card, CardHeader, btn, fmt } from '@/components/ui';

type Part = { adds: number; changes: number; unchanged: number; duplicates: number };
interface Report {
  dryRun: boolean;
  ok: boolean;
  counts: { questions: number; byCategory: Record<string, number> };
  questions: Part;
  options: Part;
  profiles: Part;
  duplicates: string[];
  teenRefused: string[];
  errors: string[];
}

/**
 * Import runs as a dry run first and shows adds, changes and duplicates (spec module 3). "Apply" unlocks only for a
 * clean dry run of the same file, and needs qb.publish on the server.
 */
export function BankImport() {
  const [pending, start] = useTransition();
  const [file, setFile] = useState<{ name: string; json?: unknown; xlsx?: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const load = async (f: File | undefined) => {
    setReport(null);
    if (!f) return setFile(null);
    if (/\.xlsx$/i.test(f.name)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return setFile({ name: f.name, xlsx: btoa(bin) });
    }
    try {
      const json = JSON.parse(await f.text()) as Record<string, unknown>;
      setFile({ name: f.name, json });
    } catch {
      toast.error('That file is not JSON or an Excel workbook. Use the Profile / Question / Option export shape.');
    }
  };
  const go = (write: boolean) =>
    start(async () => {
      if (!file) return;
      const r = file.xlsx !== undefined ? await importXlsxAction(file.xlsx, write) : await importAction(file.json, write);
      if (!r.ok) return void toast.error(r.error);
      setReport(r.data as unknown as Report);
      toast.success(write ? 'Imported' : 'Dry run finished. Nothing was changed.');
    });
  const part = (label: string, p: Part) => (
    <tr>
      <td className="px-5 py-2 font-medium">{label}</td>
      <td className="num px-5 py-2">{fmt(p.adds)}</td>
      <td className="num px-5 py-2">{fmt(p.changes)}</td>
      <td className="num px-5 py-2">{fmt(p.unchanged)}</td>
      <td className="num px-5 py-2">{fmt(p.duplicates)}</td>
    </tr>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card>
        <CardHeader
          title="Export"
          hint="The whole bank of this brand, in today's Profile / Question / Option shape. The Excel workbook has one sheet per part and imports back unchanged."
        />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <a className={btn.secondary} href="/question-bank/export?format=xlsx">
            Download bank (Excel)
          </a>
          <a className={btn.secondary} href="/question-bank/export">
            Download bank (JSON)
          </a>
        </div>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader
          title="Import"
          hint="An Excel workbook or a JSON file with Profile, Question and Option parts. Nothing is ever deleted; options left out of a question are retired."
        />
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 text-[13px]">
          <input type="file" accept="application/json,.json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => load(e.target.files?.[0])} />
          <button className={btn.secondary} disabled={pending || !file} onClick={() => go(false)}>
            Dry run
          </button>
          <button
            className={btn.primary}
            disabled={pending || !report?.dryRun || !report.ok}
            onClick={() => go(true)}
          >
            Apply import
          </button>
        </div>
        {report ? (
          <div className="grid gap-3 border-t border-border pb-4 text-[13px]">
            <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
              <Badge tone={report.ok ? 'teal' : 'danger'}>{report.ok ? 'Clean' : 'Needs fixing'}</Badge>
              <span>
                {report.dryRun ? 'Dry run' : 'Imported'}: {fmt(report.counts.questions)} questions in the file
                {Object.entries(report.counts.byCategory)
                  .map(([k, v]) => ` · ${k} ${fmt(v)}`)
                  .join('')}
              </span>
            </div>
            <table className="mx-5 text-left">
              <thead className="text-[11px] uppercase tracking-wider text-fg-3">
                <tr>
                  <th className="px-5 py-1.5" />
                  <th className="px-5 py-1.5">Adds</th>
                  <th className="px-5 py-1.5">Changes</th>
                  <th className="px-5 py-1.5">Unchanged</th>
                  <th className="px-5 py-1.5">Duplicates</th>
                </tr>
              </thead>
              <tbody>
                {part('Questions', report.questions)}
                {part('Options', report.options)}
                {part('Profiles', report.profiles)}
              </tbody>
            </table>
            {[
              ['Teen guardrail refusals', report.teenRefused],
              ['Duplicates', report.duplicates],
              ['Broken references', report.errors],
            ].map(([title, list]) =>
              (list as string[]).length ? (
                <div key={title as string} className="px-5">
                  <p className="font-medium text-danger">{title as string}</p>
                  <ul className="mt-1 list-disc pl-5 text-fg-2">
                    {(list as string[]).slice(0, 30).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
