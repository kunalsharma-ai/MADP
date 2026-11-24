import { MAILER_TO_STUDIO } from '@madp/contracts';

/** A mailer that cannot become a studio template, with the reasons in words for the screen. */
export interface StudioBlock {
  code: 'not_a_campaign' | 'internal' | 'liquid_logic' | 'panel_field' | 'filter';
  message: string;
}

const COMMENT = /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g;
const OUTPUT = /\{\{-?\s*([\s\S]*?)\s*-?\}\}/g;
const LOGIC = /\{%[\s\S]*?%\}/;
/** `field` or `field | default: "x"` (single or double quotes). Any other filter is Liquid the studio does not run. */
const SIMPLE = /^([a-zA-Z_][\w.]*)\s*(?:\|\s*default:\s*(?:"([^"{}]*)"|'([^'{}]*)'))?$/;

/**
 * Turns one Liquid part of a mailer (subject, HTML or text) into studio placeholders. The studio renderer only fills
 * values and fallbacks, so Liquid logic, other filters and fields the panel fills at send time are reported instead
 * of being dropped or sent as literal text.
 */
export function liquidToStudio(liquid: string): { out: string; blocks: StudioBlock[] } {
  const blocks: StudioBlock[] = [];
  const body = liquid.replace(COMMENT, '');
  if (LOGIC.test(body))
    blocks.push({ code: 'liquid_logic', message: 'Uses Liquid logic ({% if %}, {% assign %} and so on), which the studio does not run.' });
  const out = body.replace(OUTPUT, (whole, expr: string) => {
    const m = SIMPLE.exec(expr.trim());
    if (!m) {
      blocks.push({ code: 'filter', message: `Uses Liquid filters the studio does not run: ${whole.slice(0, 80)}` });
      return whole;
    }
    const placeholder = MAILER_TO_STUDIO[m[1]!];
    if (!placeholder) {
      blocks.push({ code: 'panel_field', message: `Needs ${m[1]}, which only the panel knows when it sends.` });
      return whole;
    }
    const fallback = m[2] ?? m[3];
    return fallback !== undefined ? `{{ ${placeholder} | default: "${fallback}" }}` : `{{${placeholder}}}`;
  });
  return { out, blocks: dedupe(blocks) };
}

/** One line per kind of problem, so a long template does not list every place it uses a filter. */
export function summarise(blocks: StudioBlock[]): StudioBlock[] {
  const out: StudioBlock[] = [];
  const logic = blocks.find((b) => b.code === 'liquid_logic');
  if (logic) out.push(logic);
  const fields = [...new Set(blocks.filter((b) => b.code === 'panel_field').map((b) => /Needs (\S+),/.exec(b.message)![1]!))];
  if (fields.length) out.push({ code: 'panel_field', message: `Needs ${fields.join(', ')}, which only the panel knows when it sends.` });
  const filters = blocks.filter((b) => b.code === 'filter');
  if (filters.length)
    out.push({
      code: 'filter',
      message: `Uses Liquid filters the studio does not run in ${filters.length} place${filters.length > 1 ? 's' : ''}, for example ${filters[0]!.message.replace(/^.*?: /, '')}`,
    });
  return [...out, ...blocks.filter((b) => !['liquid_logic', 'panel_field', 'filter'].includes(b.code))];
}

function dedupe(blocks: StudioBlock[]) {
  const seen = new Set<string>();
  return blocks.filter((b) => (seen.has(b.message) ? false : (seen.add(b.message), true)));
}

/**
 * Marketing and onboarding messages need an unsubscribe and a preferences link in both parts. Where the designers'
 * version has none, one plain line is added at the end, and the change is listed so the reviewer sees it.
 */
export function ensureFooterLinks(html: string, text: string): { html: string; text: string; added: string[] } {
  const added: string[] = [];
  const has = (s: string, p: string) => new RegExp(`\\{\\{\\s*${p}\\b`).test(s);
  if (!has(html, 'unsubscribeUrl') || !has(html, 'preferencesUrl')) {
    const line =
      '<p style="margin:12px 0;font:12px/1.6 sans-serif;color:#6b7280;text-align:center">' +
      '<a href="{{preferencesUrl}}" style="color:#6b7280">Email preferences</a> · ' +
      '<a href="{{unsubscribeUrl}}" style="color:#6b7280">Unsubscribe</a></p>';
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${line}</body>`) : `${html}${line}`;
    added.push('An email preferences and unsubscribe line at the end of the HTML part.');
  }
  if (!has(text, 'unsubscribeUrl') || !has(text, 'preferencesUrl')) {
    text = `${text.trimEnd()}\n\nEmail preferences: {{preferencesUrl}}\nUnsubscribe: {{unsubscribeUrl}}\n`;
    added.push('Email preferences and unsubscribe links at the end of the text part.');
  }
  return { html, text, added };
}
