/** The filters on screen as one line for a download ("Status: open · Search: refund"). Paging keys are left out. */
export function scopeText(
  sp: Record<string, string | string[] | undefined>,
  labels: Record<string, string> = {},
): string | undefined {
  const parts = Object.entries(sp)
    .filter(([k, v]) => v !== undefined && v !== '' && !['before', 'after', 'cursor'].includes(k))
    .map(
      ([k, v]) =>
        `${labels[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())}: ${Array.isArray(v) ? v.join(', ') : v}`,
    );
  return parts.length ? parts.join(' · ').slice(0, 400) : undefined;
}
