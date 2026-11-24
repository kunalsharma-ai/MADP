import { apiRaw } from '@/lib/api';

/** Passes a report download through from the API, which checks permissions and audits it. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!/^[a-z_]+$/.test(key)) return new Response('Bad request', { status: 400 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['format', 'panel', 'from', 'to']) {
    const v = src.get(k);
    if (v && /^[a-z0-9-]+$/i.test(v)) qs.set(k, v);
  }
  const res = await apiRaw(`/reports/${key}/export?${qs}`);
  if (!res.ok) return new Response(await res.text(), { status: res.status });
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'no-store',
    },
  });
}
