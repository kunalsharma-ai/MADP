import { z } from 'zod';

const panelList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(['t2o', 'mfr', 'mho'])));

const key32 = (v: string) => Buffer.from(v, 'base64').length === 32;

/** "k2=<base64>,k3=<base64>": extra field-encryption keys by id, for rotation. */
const keyRing = z
  .string()
  .default('')
  .transform((v, ctx) => {
    const out: Record<string, string> = {};
    for (const part of v.split(',').map((s) => s.trim()).filter(Boolean)) {
      const i = part.indexOf('=');
      const id = part.slice(0, i).trim();
      const key = part.slice(i + 1).trim();
      if (i < 1 || !/^k\d+$/.test(id) || id === 'k1' || !key32(key)) {
        ctx.addIssue({ code: 'custom', message: 'entries must be k<n>=<32-byte base64 key>, and k1 is FIELD_ENCRYPTION_KEY' });
        return z.NEVER;
      }
      out[id] = key;
    }
    return out;
  });

/** Comma-separated webhook signing secrets for one panel. Several at once let a secret be rotated without downtime. */
const secretList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(32, 'each webhook secret must be at least 32 characters')));

/**
 * API runtime configuration. Secrets come from the environment (populated by the secrets manager in
 * staging/production, by an uncommitted .env locally). Nothing secret has a default.
 */
export const ApiEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  MONGODB_URL: z.string().min(1),
  MONGODB_DB: z.string().default('madp'),
  /** HS256 signing secret for admin session tokens, >= 32 chars. */
  AUTH_JWT_SECRET: z.string().min(32),
  /** 32-byte key, base64. Encrypts PII fields (AES-256-GCM). Rotate via key id prefix (see SECURITY_PRIVACY.md). */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine(key32, 'must be 32 bytes, base64'),
  /** More field-encryption keys by id (rotation). The key `k1` is always FIELD_ENCRYPTION_KEY. */
  FIELD_ENCRYPTION_KEYS: keyRing,
  /** Key id new values are encrypted with. Old values stay readable while their key is listed. */
  FIELD_ENCRYPTION_ACTIVE_KEY: z.string().regex(/^k\d+$/).default('k1'),
  /** Separate key for keyed hashes used for matching (HMAC-SHA256), so hashes cannot be brute-forced without it. */
  PII_HASH_KEY: z.string().min(32),
  /** Require TOTP MFA for every admin login. Defaults on; tests and local demo may turn it off. */
  REQUIRE_MFA: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AUTH_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  /** An admin session ends after this many minutes without a request (super admin spec: 30). */
  ADMIN_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  /** Allowed browser origin for the admin app. */
  ADMIN_ORIGIN: z.string().url().default('http://localhost:3000'),
  /**
   * Panels for which live, read-only access to production personal data has been explicitly approved.
   * Empty = every connector runs in DEMO mode. See docs/SECURITY_PRIVACY.md section 4.
   */
  LIVE_SOURCE_APPROVED_PANELS: panelList,
  T2O_API_BASE_URL: z.string().url().optional(),
  T2O_API_TOKEN: z.string().optional(),
  MFR_API_BASE_URL: z.string().url().optional(),
  MFR_API_TOKEN: z.string().optional(),
  MHO_API_BASE_URL: z.string().url().optional(),
  MHO_API_TOKEN: z.string().optional(),
  /** Minimum cell size below which counts are suppressed in privacy-sensitive views. */
  MIN_CELL_SIZE: z.coerce.number().int().min(0).default(5),
  /** Minimum cell size for counts that use a special-category (health) filter. Never below MIN_CELL_SIZE. */
  SENSITIVE_MIN_CELL_SIZE: z.coerce.number().int().min(0).default(10),
  DEMO_POPULATION_SIZE: z.coerce.number().int().positive().default(1500),
  /**
   * Automatic sync: minutes between changed-since reads of each live panel (T2O GET /api/v1/changes/*).
   * 0 = off (the default). Only panels in LIVE_SOURCE_APPROVED_PANELS are synced on a schedule.
   */
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(0),
  /** Most feed pages one sync run reads per feed; the next run continues from the saved cursor. */
  SYNC_MAX_PAGES: z.coerce.number().int().positive().default(100),
  /**
   * Signed webhook intake (POST /webhooks/:panel). No secret = the panel's webhook route answers 404, and MADP
   * relies on the scheduled sync alone.
   */
  WEBHOOK_SECRETS_T2O: secretList,
  WEBHOOK_SECRETS_MFR: secretList,
  WEBHOOK_SECRETS_MHO: secretList,
  /** Largest clock difference accepted on a webhook timestamp, in seconds (replay protection). */
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
});
export type ApiEnv = z.infer<typeof ApiEnv>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const parsed = ApiEnv.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid API configuration: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.REQUIRE_MFA)
    throw new Error('Invalid API configuration: REQUIRE_MFA cannot be false in production (two-factor is required for every admin)');
  if (env.FIELD_ENCRYPTION_ACTIVE_KEY !== 'k1' && !env.FIELD_ENCRYPTION_KEYS[env.FIELD_ENCRYPTION_ACTIVE_KEY])
    throw new Error(
      `Invalid API configuration: FIELD_ENCRYPTION_ACTIVE_KEY ${env.FIELD_ENCRYPTION_ACTIVE_KEY} is not in FIELD_ENCRYPTION_KEYS`,
    );
  return env;
}
