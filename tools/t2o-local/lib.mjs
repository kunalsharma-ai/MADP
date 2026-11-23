import fs from 'node:fs';
export const BASE = process.env.T2O_LOCAL_API ?? 'http://t2o.localhost/api/v1';
export const OUTBOX = new URL('./outbox.jsonl', import.meta.url);
export async function call(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      host: 't2o.localhost',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  const cookie = r.headers.get('set-cookie') ?? '';
  const m = /authorization=Bearer%20([^;]+)/.exec(cookie) ?? /authorization=Bearer ([^;]+)/.exec(cookie);
  return { http: r.status, ...j, token: j.token ?? (m ? decodeURIComponent(m[1]) : undefined) };
}
export const outbox = () =>
  fs.existsSync(OUTBOX)
    ? fs
        .readFileSync(OUTBOX, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
export const lastOtpFor = (userId) => {
  const t = outbox().filter(
    (m) => m.svc === 'template' && String(m.data?.user?._id) === String(userId) && m.data?.otp,
  );
  return t.at(-1)?.data?.otp;
};
