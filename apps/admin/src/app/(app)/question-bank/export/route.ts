import { apiRaw } from '@/lib/api';

/** Downloads the brand's question bank as JSON (audited by the API). */
export async function GET() {
  const res = await apiRaw('/panel/qb/export');
  if (!res.ok) return new Response(await res.text(), { status: res.status });
  const body = await res.text();
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="question-bank-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
