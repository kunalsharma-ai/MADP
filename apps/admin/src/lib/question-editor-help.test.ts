import { describe, expect, it } from 'vitest';
import { QUESTION_TYPES } from '@madp/contracts';
import { EDITOR_SECTION_HELP, EXTRA_HELP, REGISTRY_HELP, SETTING_HELP } from './question-editor-help';

describe('question editor "i" help', () => {
  it('explains every setting any kind of question can show', () => {
    const used = new Set(QUESTION_TYPES.flatMap((t) => t.settings));
    for (const s of used) expect(SETTING_HELP[s], s).toBeDefined();
  });

  it('has why, where and how for every topic', () => {
    for (const [k, h] of Object.entries({ ...EDITOR_SECTION_HELP, ...EXTRA_HELP, ...REGISTRY_HELP, ...SETTING_HELP })) {
      expect(h.why.length, k).toBeGreaterThan(20);
      expect(h.where.length, k).toBeGreaterThan(20);
      expect(h.how.length, k).toBeGreaterThan(0);
    }
  });
});
