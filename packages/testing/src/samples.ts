import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PanelCode } from '@madp/contracts';

export interface RawSample {
  panel: PanelCode;
  /** false = synthetic placeholder (MFR); true/undefined = extracted from a source repository export. */
  verified?: boolean;
  source: string;
  extractedAt: string;
  profiles: { slug: string; name: string; sourceCategory: string; pages: string[][] }[];
  questions: { name: string; label: string; parent: string | null; category: string[] | string; type?: string }[];
  options: { question: string; label: string; value: string; parentValue: string[] }[];
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Questionnaire definitions sample for a panel (no personal data). */
export function loadSourceSample(panel: PanelCode): RawSample {
  const file = path.join(here, 'fixtures', `${panel}.source-sample.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RawSample;
}
