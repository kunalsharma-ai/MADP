import { KIND_BASIS, TEMPLATE_PLACEHOLDERS, type CampaignKind, type TemplatePlaceholder } from '@madp/contracts';

const TOKEN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]!))];
}

/**
 * Problems that stop a version from going to review: unknown placeholders, and for anything that is not a service
 * message, a missing unsubscribe or preferences link in either the HTML or the text part. Script tags and inline
 * event handlers are refused outright.
 */
export function lintTemplate(kind: CampaignKind, v: { subject: string; bodyHtml: string; bodyText: string }): string[] {
  const problems: string[] = [];
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS);
  for (const p of placeholdersIn(`${v.subject}\n${v.bodyHtml}\n${v.bodyText}`))
    if (!known.has(p)) problems.push(`Unknown placeholder {{${p}}}`);
  if (KIND_BASIS[kind] !== 'service')
    for (const need of ['unsubscribeUrl', 'preferencesUrl'] as const) {
      if (!placeholdersIn(v.bodyHtml).includes(need)) problems.push(`The HTML part needs {{${need}}}`);
      if (!placeholdersIn(v.bodyText).includes(need)) problems.push(`The text part needs {{${need}}}`);
    }
  if (/<script\b/i.test(v.bodyHtml)) problems.push('Script tags are not allowed in e-mail');
  if (/\son[a-z]+\s*=/i.test(v.bodyHtml)) problems.push('Inline event handlers are not allowed in e-mail');
  return problems;
}

export function render(
  v: { subject: string; bodyHtml: string; bodyText: string },
  values: Partial<Record<TemplatePlaceholder, string>>,
) {
  const fill = (text: string, esc: (s: string) => string) =>
    text.replace(TOKEN, (_, k: string) => esc(values[k as TemplatePlaceholder] ?? ''));
  return {
    subject: fill(v.subject, (s) => s),
    html: fill(v.bodyHtml, escapeHtml),
    text: fill(v.bodyText, (s) => s),
  };
}
