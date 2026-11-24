import { api } from '@/lib/api';

/** Downloads a verified access request's export as a JSON file. The API checks permissions and audits it. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Bad request', { status: 400 });
  try {
    const data = await api<unknown>(`/privacy/requests/${id}/export`);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="madp-access-${id}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 403 });
  }
}
