import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce } from './csp';

describe('admin Content-Security-Policy', () => {
  it('allows scripts only with the nonce, and no inline or eval in production', () => {
    const csp = contentSecurityPolicy('abc123==', false);
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('allows Google Fonts for styles and fonts only', () => {
    const csp = contentSecurityPolicy('n', false).split('; ');
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(csp.find((d) => d.startsWith('script-src'))).not.toContain('google');
  });
  it('adds eval only in development', () => {
    expect(contentSecurityPolicy('n', true)).toContain("'unsafe-eval'");
  });
  it('makes a fresh 128-bit nonce each time', () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});
