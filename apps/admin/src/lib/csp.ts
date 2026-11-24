/**
 * The admin app's Content-Security-Policy. Scripts run only from this site and only with this response's nonce, so an
 * injected <script> or inline handler never runs, even if text from a panel slipped through escaping. 'strict-dynamic'
 * lets Next.js's own nonced scripts load their chunks. Styles keep 'unsafe-inline' for React style attributes; styles
 * cannot run code. Google Fonts is allowed for styles and fonts only, because the mailer packs use it and their
 * previews should look as they will in an inbox. Development adds 'unsafe-eval', which React needs there for error
 * overlays.
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** 128 random bits, base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
