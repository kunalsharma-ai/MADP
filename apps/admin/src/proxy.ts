import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from '@/lib/csp';

/**
 * A fresh nonce per page view. Next.js reads the nonce from the request's CSP header and puts it on its own scripts;
 * the root layout reads x-nonce for the theme script. Pages are rendered per request (the layout reads headers), so
 * no page is served with a stale nonce.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages and route handlers; not Next's static files, images or the public brand and mailer assets.
      source: '/((?!_next/static|_next/image|favicon.ico|brands/|mailers/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
