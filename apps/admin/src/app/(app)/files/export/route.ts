import { apiRawPost } from '@/lib/api';

/**
 * Every console download goes through here: the browser posts the table (or page) it shows, the API checks the
 * permissions, writes the Excel / CSV / PDF / Word file, logs it in the audit trail and sends it back.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { kind?: string } | null;
  if (!body || (body.kind !== 'table' && body.kind !== 'document'))
    return new Response('Bad request', { status: 400 });
  const { kind, ...rest } = body;
  const res = await apiRawPost(`/files/export/${kind}`, rest);
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { message?: string; problems?: string[] };
    const msg = b.problems?.length
      ? `${b.message ?? 'Refused'}: ${b.problems.join('; ')}`
      : (b.message ?? res.statusText);
    return Response.json(
      { message: res.status === 401 ? 'Your session ended. Sign in again.' : msg },
      { status: res.status },
    );
  }
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'no-store',
    },
  });
}
