/**
 * What a server action returns. Next.js hides a thrown error's message in production builds, so actions return the
 * API's message as data and the client turns it back into an error for its toast.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** The action's data, or an Error carrying the API's message. */
export async function unwrap<T>(r: Result<T> | Promise<Result<T>>): Promise<T> {
  const x = await r;
  if (!x.ok) throw new Error(x.error);
  return x.data;
}
