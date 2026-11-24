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

const TAG = /\{%-?\s*([\s\S]*?)\s*-?%\}/g;
const COND = /^([a-z_][\w.]*)\s*(<|<=|>|>=|==|!=)\s*(-?\d+)$/i;

/**
 * Works out a mailer's Liquid logic ahead of time when every value it tests is fixed by the mailer's audience (for
 * example "no profile completed yet" means the completed count is 0). Only numeric `assign` with a default, `if`,
 * `elsif`, `else` and `endif` with comparisons joined by `and` or `or` are understood. Anything else returns null, so
 * the mailer stays refused rather than being sent with the wrong branch. Output tags (`{{ … }}`) are left for
 * `liquidToStudio`.
 */
export function flattenLiquid(liquid: string, fixed: Record<string, number>): string | null {
  const vars: Record<string, number> = { ...fixed };
  const value = (name: string) => (name in vars ? vars[name] : undefined);
  const test = (cond: string): boolean | null => {
    const parts = cond.split(/\s+(and|or)\s+/);
    let result: boolean | null = null;
    let op = 'and';
    for (const part of parts) {
      if (part === 'and' || part === 'or') {
        op = part;
        continue;
      }
      const m = COND.exec(part.trim());
      const v = m ? value(m[1]!) : undefined;
      if (!m || v === undefined) return null;
      const n = Number(m[3]);
      const ok = { '<': v < n, '<=': v <= n, '>': v > n, '>=': v >= n, '==': v === n, '!=': v !== n }[m[2]!]!;
      result = result === null ? ok : op === 'and' ? result && ok : result || ok;
    }
    return result;
  };
  // Each open `if` remembers whether its enclosing block is shown, whether a branch was taken, and whether the current
  // branch is shown.
  const stack: { outer: boolean; taken: boolean; on: boolean }[] = [];
  const shown = () => (stack.length ? stack[stack.length - 1]!.on : true);
  let out = '';
  let last = 0;
  const body = liquid.replace(COMMENT, '');
  for (const m of body.matchAll(TAG)) {
    if (shown()) out += body.slice(last, m.index);
    last = m.index! + m[0].length;
    const tag = m[1]!.trim();
    const [word] = tag.split(/\s+/, 1);
    const rest = tag.slice(word!.length).trim();
    if (word === 'assign') {
      const a = /^([a-z_]\w*)\s*=\s*([a-z_][\w.]*)(?:\s*\|\s*default:\s*(-?\d+))?$/i.exec(rest);
      if (!a) return null;
      if (!shown()) continue;
      const v = value(a[2]!) ?? (a[3] !== undefined ? Number(a[3]) : undefined);
      if (v === undefined) return null;
      vars[a[1]!] = v;
    } else if (word === 'if') {
      const outer = shown();
      const t = outer ? test(rest) : false;
      if (t === null) return null;
      stack.push({ outer, taken: t, on: outer && t });
    } else if (word === 'elsif') {
      const s = stack[stack.length - 1];
      if (!s) return null;
      const t = s.outer && !s.taken ? test(rest) : false;
      if (t === null) return null;
      s.on = s.outer && !s.taken && t;
      s.taken ||= t;
    } else if (word === 'else') {
      const s = stack[stack.length - 1];
      if (!s) return null;
      s.on = s.outer && !s.taken;
      s.taken = true;
    } else if (word === 'endif') {
      if (!stack.pop()) return null;
    } else return null;
  }
  if (stack.length) return null;
  return out + body.slice(last);
}
