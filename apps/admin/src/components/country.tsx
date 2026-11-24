import { cn } from '@/lib/cn';

const regionName = new Intl.DisplayNames(['en'], { type: 'region' });

/** Upper-case ISO 3166-1 alpha-2 code, or null when the value is not one (blank, "unknown", free text). */
export function isoCode(v: string | null | undefined): string | null {
  const c = (v ?? '').trim();
  return /^[a-z]{2}$/i.test(c) ? c.toUpperCase() : null;
}

/** English country name for an ISO code; falls back to the raw value. */
export function countryName(v: string | null | undefined): string {
  const code = isoCode(v);
  if (!code) return !v || v.toLowerCase() === 'unknown' ? 'Not given' : v;
  try {
    return regionName.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The country's flag (SVG from flag-icons, so it shows on Windows too), drawn decoratively. */
export function Flag({ code, className }: { code: string | null | undefined; className?: string }) {
  const c = isoCode(code);
  if (!c) return <span className={cn('inline-block w-[1.333em] shrink-0', className)} aria-hidden />;
  return <span className={cn(`fi fi-${c.toLowerCase()} shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0/0.08)]`, className)} aria-hidden />;
}

/** Flag, short code and (unless compact) the full name, e.g. 🇮🇳 IN India. */
export function Country({ code, compact, className }: { code: string | null | undefined; compact?: boolean; className?: string }) {
  const c = isoCode(code);
  const name = countryName(code);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={c ? `${name} (${c})` : undefined}>
      <Flag code={code} />
      {c ? <span className="font-mono text-[11px] font-semibold tracking-wide text-fg-2">{c}</span> : null}
      {compact && c ? null : <span>{name}</span>}
    </span>
  );
}
