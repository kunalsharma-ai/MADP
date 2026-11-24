import { apiRaw } from '@/lib/api';

/** Streams the audit CSV from the API with the admin's session and brand; the API logs the export. */
export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams.toString();
  const res = await apiRaw(`/audit/export?${qs}`);
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'text/csv',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="madp-audit.csv"',
      'cache-control': 'no-store',
    },
  });
}
