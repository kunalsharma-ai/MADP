'use server';

import type { ParsedFile } from '@madp/contracts';
import { api, ApiError } from '@/lib/api';
import type { Result } from '@/lib/result';

/** Reads an uploaded spreadsheet or Word file into rows or page blocks for a preview. Nothing is saved. */
export async function parseFileAction(
  name: string,
  kind: 'table' | 'document',
  data: string,
): Promise<Result<ParsedFile>> {
  try {
    return {
      ok: true,
      data: await api<ParsedFile>('/files/parse', { method: 'POST', json: { name, kind, data } }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'The file could not be read' };
  }
}
