import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAV } from '../components/nav';
import { SCREEN_HELP, helpFor } from './screen-help';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/(app)');

/** Every page route under the console, e.g. "/members/[id]". */
function pages(dir = APP, base = ''): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) return pages(full, `${base}/${f}`);
    return f === 'page.tsx' ? [base || '/'] : [];
  });
}

describe('screen help ("i" button)', () => {
  it('has why, where and how for every menu entry', () => {
    const missing = NAV.flatMap((g) => g.items.map((i) => i.href)).filter((h) => !SCREEN_HELP[h]);
    expect(missing).toEqual([]);
    for (const [k, h] of Object.entries(SCREEN_HELP)) {
      expect(h.why.length, k).toBeGreaterThan(20);
      expect(h.where.length, k).toBeGreaterThan(20);
      expect(h.how.length, k).toBeGreaterThan(0);
    }
  });

  it('covers every console page, detail pages through their parent', () => {
    const uncovered = pages()
      .map((p) => p.replace(/\[[^\]]+\]/g, 'x'))
      .filter((p) => !helpFor(p));
    expect(uncovered).toEqual([]);
    expect(helpFor('/members/123')?.key).toBe('/members');
    expect(helpFor('/communications/mailers/a/b')?.key).toBe('/communications/mailers');
  });
});
