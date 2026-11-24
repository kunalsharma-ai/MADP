import { apiRaw } from '@/lib/api';

/** Downloads the brand's question bank as JSON, or as an Excel workbook with ?format=xlsx (audited by the API). */
export async function GET(req: Request) {
  const xlsx = new URL(req.url).searchParams.get('format') === 'xlsx';
  const res = await apiRaw(xlsx ? '/panel/qb/export/xlsx' : '/panel/qb/export');
  if (!res.ok) return new Response(await res.text(), { status: res.status });
  if (xlsx)
    return new Response(await res.arrayBuffer(), {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
        'content-disposition': res.headers.get('content-disposition') ?? 'attachment; filename="question-bank.xlsx"',
        'cache-control': 'no-store',
      },
    });
  const body = await res.text();
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="question-bank-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
