import 'server-only';
import { cache } from 'react';
import type { AudienceSegmentInfo } from '@madp/contracts';
import { api } from '@/lib/api';

/** The active audience segments (the built-in six and any added on the Audience segments screen), once per request. */
export const getSegments = cache(async (): Promise<AudienceSegmentInfo[]> => {
  const { segments } = await api<{ segments: AudienceSegmentInfo[] }>('/audience-segments');
  return segments.filter((s) => s.status === 'active');
});

/** key -> label, for chips and tables. Unknown keys (an archived segment) fall back to the key. */
export async function segmentLabels(): Promise<Record<string, string>> {
  return Object.fromEntries((await getSegments()).map((s) => [s.key, s.label]));
}
