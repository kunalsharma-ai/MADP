import { apiRaw } from '@/lib/api';

/** Passes the API's CSV template through, so the browser downloads it with the console's session. */
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!/^(members|answers|questions)$/.test(kind)) return new Response('Not found', { status: 404 });
  const res = await apiRaw(`/networks/template/${kind}`);
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="madp-network-${kind}-template.csv"`,
    },
  });
}
