'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { ExportScreen, FileFormat, ParsedBlock, ParsedDocument, ParsedTable } from '@madp/contracts';
import { parseFileAction } from '@/app/file-actions';
import { TopicInfo, type TopicHelp } from './screen-info';

export type DlColumn = { key: string; label: string; type?: 'text' | 'number' | 'date' | 'money' };
export type DlCell = string | number | boolean | null | undefined;
export type DlRow = Record<string, DlCell>;

const FORMAT: Record<FileFormat, { name: string; tag: string; hint: string; from: string; to: string }> = {
  xlsx: { name: 'Excel', tag: 'XLS', hint: 'Sort, filter and add up', from: '#22c55e', to: '#15803d' },
  csv: { name: 'CSV', tag: 'CSV', hint: 'For other tools and imports', from: '#38bdf8', to: '#0369a1' },
  pdf: { name: 'PDF', tag: 'PDF', hint: 'To print or share as is', from: '#fb7185', to: '#be123c' },
  docx: { name: 'Word', tag: 'DOC', hint: 'To edit, add notes and send', from: '#818cf8', to: '#4338ca' },
};
const MAX_ROWS = 10_000;

function FormatTile({ f, size = 'md' }: { f: FileFormat; size?: 'sm' | 'md' }) {
  const s = FORMAT[f];
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-lg font-black tracking-tight text-white shadow-[0_6px_14px_-8px_rgba(15,23,42,0.6)] ${size === 'sm' ? 'size-6 text-[8px]' : 'size-9 text-[10px]'}`}
      style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})` }}
    >
      {s.tag}
    </span>
  );
}

/** Keeps a popover inside the window (16px gutter), phones included. */
function useOnScreen(open: boolean, box: React.RefObject<HTMLDivElement | null>, width: number) {
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) return setShift(0);
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const W = window.innerWidth;
    const w = Math.min(width, W - 32);
    const left = b.right - w;
    setShift(Math.max(16, Math.min(left, W - 16 - w)) - left);
  }, [open, box, width]);
  return shift;
}

async function save(res: Response, fallback: string): Promise<string | null> {
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { message?: string };
    toast.error(b.message ?? 'The download did not work');
    return null;
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

const clean = (rows: DlRow[], columns: DlColumn[]) =>
  rows.slice(0, MAX_ROWS).map((r) =>
    Object.fromEntries(
      columns.map((c) => {
        const v = r[c.key];
        return [
          c.key,
          v === undefined ? null : typeof v === 'string' && v.length > 5000 ? `${v.slice(0, 4999)}…` : v,
        ];
      }),
    ),
  );

const DOWNLOAD_HELP = (what: string, rows: number): TopicHelp => ({
  why: `Take ${what} out of MADP: share it, print it, or work on it in Excel or Word.`,
  where: `The file holds exactly what this table shows now (${rows.toLocaleString('en-IN')} rows, with your filters and page). Masked details stay masked, hidden teens stay hidden, DEMO rows say DEMO. Every download is written to the Audit log.`,
  how: [
    'Set the filters you want first.',
    'Press Download and pick Excel, CSV, PDF or Word.',
    'The file lands in your Downloads folder. Lists with personal data need the "export with personal data" permission.',
  ],
});

function Menu({
  label,
  formats,
  busy,
  onPick,
  note,
  help,
  title,
}: {
  label: string;
  formats: FileFormat[];
  busy: FileFormat | null;
  onPick: (f: FileFormat) => void;
  note: ReactNode;
  help?: TopicHelp;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shift = useOnScreen(open, box, 288);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) =>
      box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  return (
    <span className="relative inline-flex shrink-0 items-center gap-1.5 has-[[role=menu]]:z-40">
      {help ? <TopicInfo title={`Download ${title}`} help={help} align="right" /> : null}
      <div ref={box} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="group inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface py-1 pl-1 pr-2 text-[13px] font-semibold text-fg shadow-soft transition hover:-translate-y-px hover:bg-surface-2"
        >
          <span className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-[#22c55e] via-[#0ea5e9] to-[#6366f1] text-white transition group-hover:rotate-6">
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" strokeWidth={2.5} aria-hidden />
            )}
          </span>
          {label}
          <ChevronDown className={`size-3.5 text-fg-3 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {open ? (
          <div
            role="menu"
            aria-label={`${label} as`}
            style={{ right: -shift }}
            className="rise absolute top-9 z-40 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface text-left shadow-lift"
          >
            <p className="bg-gradient-to-r from-[#ecfdf5] via-[#eff6ff] to-[#eef2ff] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-fg-2">
              {label} as
            </p>
            <div className="p-1.5">
              {formats.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="menuitem"
                  disabled={busy !== null}
                  onClick={() => {
                    setOpen(false);
                    onPick(f);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-surface-2 disabled:opacity-50"
                >
                  <FormatTile f={f} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-fg">{FORMAT[f].name}</span>
                    <span className="block text-[11.5px] text-fg-3">{FORMAT[f].hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="border-t border-border px-4 py-2 text-[11px] leading-snug text-fg-3">{note}</p>
          </div>
        ) : null}
      </div>
    </span>
  );
}

/**
 * The Download button for a table: Excel, CSV, PDF or Word of exactly the rows on screen. The API checks the
 * permissions, labels DEMO data and audits the download.
 */
export function DownloadMenu({
  screen,
  title,
  subtitle,
  columns,
  rows,
  formats = ['xlsx', 'csv', 'pdf', 'docx'],
  label = 'Download',
  info = true,
  load,
}: {
  screen: ExportScreen;
  title: string;
  /** The filters or scope on screen, printed on the file. */
  subtitle?: string | undefined;
  columns: DlColumn[];
  rows: DlRow[];
  /** Builds the rows when pressed instead (a server action), e.g. a template that needs extra lookups. */
  load?: () => Promise<{ ok: true; data: DlRow[] } | { ok: false; error: string }>;
  formats?: FileFormat[];
  label?: string;
  /** Show the Why / Where / How "i" beside the button. */
  info?: boolean;
}) {
  const [busy, setBusy] = useState<FileFormat | null>(null);
  const pick = async (format: FileFormat) => {
    setBusy(format);
    try {
      let all = rows;
      if (load) {
        const r = await load();
        if (!r.ok) return void toast.error(r.error);
        all = r.data;
      }
      const res = await fetch('/files/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'table',
          screen,
          format,
          title,
          subtitle: subtitle?.slice(0, 400) || undefined,
          columns,
          rows: clean(all, columns),
        }),
      });
      const name = await save(res, `madp-${screen}.${format}`);
      if (name)
        toast.success(`Downloaded ${name}`, {
          description:
            all.length > MAX_ROWS ? `First ${MAX_ROWS.toLocaleString('en-IN')} rows only.` : undefined,
        });
    } catch {
      toast.error('The download did not work. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Menu
      label={label}
      title={title}
      formats={formats}
      busy={busy}
      onPick={pick}
      help={info ? DOWNLOAD_HELP(title.toLowerCase(), rows.length) : undefined}
      note={
        load ? (
          'Made fresh when you press it. The download is logged.'
        ) : (
          <>
            {rows.length.toLocaleString('en-IN')} row{rows.length === 1 ? '' : 's'} as shown. Masked stays
            masked; the download is logged.
          </>
        )
      }
    />
  );
}

/** Download a page (content page, help article, mailer, questionnaire) as Word or PDF. Word files upload back. */
export function DocumentDownload({
  screen,
  title,
  subtitle,
  blocks,
  formats = ['docx', 'pdf'],
  label = 'Download',
}: {
  screen: 'content_page' | 'help_centre' | 'mailers' | 'questionnaire';
  title: string;
  subtitle?: string;
  blocks: ParsedBlock[];
  formats?: ('docx' | 'pdf')[];
  label?: string;
}) {
  const [busy, setBusy] = useState<FileFormat | null>(null);
  const pick = async (format: FileFormat) => {
    if (!blocks.length) return void toast.error('There is nothing on this page to download yet.');
    setBusy(format);
    try {
      const res = await fetch('/files/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'document',
          screen,
          format,
          title,
          subtitle,
          blocks: blocks.slice(0, 400),
        }),
      });
      const name = await save(res, `madp-${screen}.${format}`);
      if (name) toast.success(`Downloaded ${name}`);
    } catch {
      toast.error('The download did not work. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Menu
      label={label}
      title={title}
      formats={formats}
      busy={busy}
      onPick={pick}
      help={{
        why: 'Send this page for review, print it, or edit it in Word.',
        where:
          'The file is made from the text shown here, with the brand and data mode on top. Every download is logged in the Audit log.',
        how: [
          'Pick Word to edit it, or PDF to share it as is.',
          'Edited Word files can be uploaded back with Upload Word: the text fills the editor, and nothing is saved until you press Save.',
        ],
      }}
      note="Word files keep headings, lists, notes and tables, so they can be uploaded back."
    />
  );
}

/** The same menu for downloads the API builds itself from a GET link (reports, whole question bank). */
export function LinkDownloads({
  title,
  links,
  note,
  help,
}: {
  title: string;
  links: Partial<Record<FileFormat, string>>;
  note?: ReactNode;
  help?: TopicHelp;
}) {
  const formats = (Object.keys(FORMAT) as FileFormat[]).filter((f) => links[f]);
  return (
    <Menu
      label="Download"
      title={title}
      formats={formats}
      busy={null}
      onPick={(f) => {
        window.location.href = links[f]!;
        toast.success(`Preparing the ${FORMAT[f].name} file…`);
      }}
      help={help}
      note={note ?? 'Every row of the report, with the data mode on each. The download is logged.'}
    />
  );
}

function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const ACCEPT = {
  table: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  document: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * The Upload button: picks an Excel/CSV (table) or Word (document) file, reads it on the server and hands the rows or
 * blocks to the screen for a preview. It never saves anything itself.
 */
export function UploadButton<K extends 'table' | 'document'>({
  kind,
  label,
  onParsed,
  help,
  title,
  disabled,
}: {
  kind: K;
  label?: string;
  onParsed: (r: K extends 'table' ? ParsedTable : ParsedDocument, fileName: string) => void;
  help?: TopicHelp;
  title?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024)
      return void toast.error('That file is over 10 MB. Split it into smaller files.');
    setBusy(true);
    try {
      const r = await parseFileAction(f.name, kind, toBase64(new Uint8Array(await f.arrayBuffer())));
      if (!r.ok) return void toast.error(r.error);
      onParsed(r.data as K extends 'table' ? ParsedTable : ParsedDocument, f.name);
    } catch {
      toast.error('The file could not be read. Try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <span className="relative inline-flex shrink-0 items-center gap-1.5 has-[[role=dialog]]:z-40">
      {help ? <TopicInfo title={title ?? 'Upload'} help={help} align="right" /> : null}
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        className="group inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface py-1 pl-1 pr-2.5 text-[13px] font-semibold text-fg shadow-soft transition hover:-translate-y-px hover:bg-surface-2 disabled:opacity-50"
      >
        <span className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-[#f59e0b] via-[#ec4899] to-[#8b5cf6] text-white transition group-hover:-rotate-6">
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-3.5" strokeWidth={2.5} aria-hidden />
          )}
        </span>
        {label ?? (kind === 'table' ? 'Upload Excel / CSV' : 'Upload Word')}
      </button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={ACCEPT[kind]}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </span>
  );
}

/** Header row of a parsed sheet mapped to wanted keys by name (case, spaces and dashes ignored), plus missing keys. */
export function mapHeader(
  head: string[],
  want: Record<string, string[]>,
): { index: Record<string, number>; missing: string[] } {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-()]+/g, '');
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, names] of Object.entries(want)) {
    const i = head.findIndex((h) => [key, ...names].some((n) => norm(n) === norm(h)));
    if (i >= 0) index[key] = i;
    else missing.push(key);
  }
  return { index, missing };
}

export { FormatTile };
