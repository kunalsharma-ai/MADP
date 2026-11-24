import { Fragment, type ReactNode } from 'react';

/** Plain text with https:// and e-mail addresses as links, the way the panel sites show them. */
function linked(text: string): ReactNode[] {
  return text.split(/(https:\/\/[^\s)]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g).map((part, i) =>
    /^https:\/\//.test(part) ? (
      <a key={i} href={part} rel="noreferrer noopener" target="_blank" className="text-accent underline">
        {part}
      </a>
    ) : /@/.test(part) && /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(part) ? (
      <a key={i} href={`mailto:${part}`} className="text-accent underline">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Renders a page body (the panel's blocks) as plain elements. Nothing is read as HTML. */
export function ContentView({ title, body }: { title: string; body: unknown[] }) {
  return (
    <article className="grid gap-3 text-[14px] leading-relaxed">
      <h1 className="text-xl font-semibold">{title}</h1>
      {body.map((b, i) => {
        if (typeof b === 'string') return <p key={i} className="whitespace-pre-line">{linked(b)}</p>;
        const o = b as Record<string, unknown>;
        if ('h2' in o) return <h2 key={i} className="mt-2 text-[16px] font-semibold">{String(o.h2)}</h2>;
        if ('h3' in o) return <h3 key={i} className="font-semibold">{String(o.h3)}</h3>;
        if ('note' in o)
          return (
            <p key={i} className="rounded-lg border border-border bg-surface-2 px-3 py-2 whitespace-pre-line">
              {linked(String(o.note))}
            </p>
          );
        if ('ul' in o)
          return (
            <ul key={i} className="list-disc pl-5">
              {(o.ul as string[]).map((x, j) => <li key={j}>{linked(x)}</li>)}
            </ul>
          );
        if ('ol' in o)
          return (
            <ol key={i} className="list-decimal pl-5">
              {(o.ol as string[]).map((x, j) => <li key={j}>{linked(x)}</li>)}
            </ol>
          );
        if ('table' in o) {
          const t = o.table as { head: string[]; rows: string[][] };
          return (
            <table key={i} className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr>{t.head.map((h, j) => <th key={j} className="border-b border-border px-2 py-1.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {t.rows.map((r, j) => (
                  <tr key={j}>{r.map((c, k) => <td key={k} className="border-b border-border px-2 py-1.5">{linked(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          );
        }
        return null;
      })}
    </article>
  );
}
