import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ApiError } from '@/lib/api';
import type { Result } from '@/lib/result';

/** Runs a server action's work and returns its result or the API's error message (see lib/result.ts). */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    // Next.js control flow (a redirect to sign-in, for one) must still propagate.
    unstable_rethrow(e);
    return { ok: false, error: e instanceof ApiError ? e.message : 'Something went wrong' };
  }
}
