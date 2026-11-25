import { describe, expect, it } from 'vitest';
import { PanelAdminClient, signPanelAdmin } from '@madp/connectors';

/**
 * The signed panel admin protocol (kunalsharma-ai/MFR#62): every call carries a fresh x-madp-nonce inside the
 * signature, so the panel can accept each request once, and the client never follows a redirect with signed headers.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const ACTOR = '11111111-2222-3333-4444-555555555555';

describe('panel admin client signing', () => {
  it('signs a new nonce into every call and refuses redirects', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ status: 'success', data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = new PanelAdminClient('mfr', {
      baseUrl: 'http://panel.internal',
      origin: 'www.myfrequentrewards.com',
      secret: SECRET,
      fetchImpl,
      now: () => 1_800_000_000_000,
    });
    await client.call(ACTOR, 'POST', '/api/v1/admin/members/restore', undefined, { ids: [] });
    await client.call(ACTOR, 'POST', '/api/v1/admin/members/restore', undefined, { ids: [] });
    const h = calls.map((c) => c.init.headers as Record<string, string>);
    expect(h[0]!['x-madp-nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(h[0]!['x-madp-nonce']).not.toBe(h[1]!['x-madp-nonce']);
    expect(h[0]!['x-madp-signature']).not.toBe(h[1]!['x-madp-signature']);
    for (const c of calls) expect(c.init.redirect).toBe('error');
    const want = await signPanelAdmin(SECRET, {
      timestamp: h[0]!['x-madp-timestamp']!,
      nonce: h[0]!['x-madp-nonce']!,
      method: 'POST',
      path: '/api/v1/admin/members/restore',
      origin: 'www.myfrequentrewards.com',
      actor: ACTOR,
      body: JSON.stringify({ ids: [] }),
    });
    expect(h[0]!['x-madp-signature']).toBe(want);
    // a different nonce gives a different signature, so the nonce can't be swapped on a copied request
    const other = await signPanelAdmin(SECRET, {
      timestamp: h[0]!['x-madp-timestamp']!,
      nonce: '0'.repeat(32),
      method: 'POST',
      path: '/api/v1/admin/members/restore',
      origin: 'www.myfrequentrewards.com',
      actor: ACTOR,
      body: JSON.stringify({ ids: [] }),
    });
    expect(other).not.toBe(want);
  });
});
