import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import { API_ENV } from './tokens.js';

const WINDOW_MS = 10 * 60_000;
const BLOCK_MS = 15 * 60_000;
/** Bound on tracked addresses, so a flood of spoofed or rotating addresses can't grow memory without limit. */
const MAX_TRACKED = 50_000;

/**
 * Bot and brute-force brake for the routes that answer without a session and check their own credentials (Supply360
 * signed requests, panel webhooks). Each refused request counts against its client address; past the limit the
 * address gets 429 for 15 minutes, answered before any database work, and only the first refusal of a block is
 * audited, so a flood can't fill the audit log or the database. Per API instance; the load balancer or WAF in front
 * of production adds the shared layer (docs/SECURITY_PRIVACY.md).
 */
@Injectable()
export class AbuseService {
  private readonly failures = new Map<string, number[]>();
  private readonly blocked = new Map<string, number>();

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  private key(scope: string, ip: string | undefined) {
    return `${scope}|${ip ?? 'unknown'}`;
  }

  /** Throws 429 while the address is blocked for this scope. */
  check(scope: string, ip: string | undefined, now = Date.now()) {
    const k = this.key(scope, ip);
    const until = this.blocked.get(k);
    if (until === undefined) return;
    if (until > now) throw new HttpException('Too many refused requests from this address. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    this.blocked.delete(k);
  }

  /**
   * Records one refused request. Returns whether it should be audited: every refusal below the limit, and the one
   * that starts a block (with `blocked: true`), but none while the block holds.
   */
  fail(scope: string, ip: string | undefined, now = Date.now()): { audit: boolean; blocked: boolean } {
    const k = this.key(scope, ip);
    if ((this.blocked.get(k) ?? 0) > now) return { audit: false, blocked: true };
    if (this.failures.size >= MAX_TRACKED && !this.failures.has(k)) this.prune(now);
    const recent = (this.failures.get(k) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    if (recent.length >= this.env.ABUSE_MAX_FAILURES) {
      this.failures.delete(k);
      this.blocked.set(k, now + BLOCK_MS);
      return { audit: true, blocked: true };
    }
    this.failures.set(k, recent);
    return { audit: true, blocked: false };
  }

  private prune(now: number) {
    for (const [k, ts] of this.failures) if (!ts.some((t) => now - t < WINDOW_MS)) this.failures.delete(k);
    for (const [k, until] of this.blocked) if (until <= now) this.blocked.delete(k);
    // Still full of live entries: drop the oldest half rather than grow.
    if (this.failures.size >= MAX_TRACKED) [...this.failures.keys()].slice(0, MAX_TRACKED / 2).forEach((k) => this.failures.delete(k));
  }
}
