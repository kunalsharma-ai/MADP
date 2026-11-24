import type { ContentBlock } from '@madp/contracts';

/**
 * Page bodies are edited as plain text and stored as the panel's blocks:
 *   ## Heading · ### Sub-heading · "- " lines a list · "1. " lines a numbered list · "> " a note ·
 *   "| a | b |" lines a table (first line is the header). Paragraphs are separated by a blank line.
 * No HTML: links are written as plain https:// or e-mail addresses and the sites turn them into links.
 */
export function textToBlocks(text: string): ContentBlock[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p): ContentBlock => {
      const lines = p.split('\n').map((l) => l.trim());
      if (lines.length === 1 && p.startsWith('### ')) return { h3: p.slice(4).trim() };
      if (lines.length === 1 && p.startsWith('## ')) return { h2: p.slice(3).trim() };
      if (lines.every((l) => l.startsWith('- '))) return { ul: lines.map((l) => l.slice(2).trim()) };
      if (lines.every((l) => /^\d+\.\s/.test(l))) return { ol: lines.map((l) => l.replace(/^\d+\.\s+/, '').trim()) };
      if (lines.every((l) => l.startsWith('|'))) {
        const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const [head, ...rows] = lines.filter((l) => !/^\|[\s:|-]+\|?$/.test(l)).map(cells);
        return { table: { head: head!, rows } };
      }
      if (p.startsWith('> ')) return { note: lines.map((l) => l.replace(/^>\s?/, '')).join('\n').trim() };
      return lines.join('\n');
    });
}

export function blocksToText(blocks: unknown[]): string {
  return blocks
    .map((b) => {
      if (typeof b === 'string') return b;
      const o = b as Record<string, unknown>;
      if ('h2' in o) return `## ${o.h2}`;
      if ('h3' in o) return `### ${o.h3}`;
      if ('note' in o) return `> ${o.note}`;
      if ('ul' in o) return (o.ul as string[]).map((x) => `- ${x}`).join('\n');
      if ('ol' in o) return (o.ol as string[]).map((x, i) => `${i + 1}. ${x}`).join('\n');
      if ('table' in o) {
        const t = o.table as { head: string[]; rows: string[][] };
        return [t.head, ...t.rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
      }
      return JSON.stringify(b);
    })
    .join('\n\n');
}
