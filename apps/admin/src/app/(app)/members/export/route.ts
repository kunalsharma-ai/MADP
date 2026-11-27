import { apiRaw } from '@/lib/api';

/** Downloads the Members list (ticked rows or the filtered list) as CSV or Excel. The API checks and audits it. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const res = await apiRaw('/member-bulk/export', body);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    return Response.json({ message: err?.message ?? 'Export failed' }, { status: res.status });
  }
  return new Response(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment; filename="members.csv"',
      'cache-control': 'no-store',
    },
  });
}
