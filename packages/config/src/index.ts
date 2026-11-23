import { z } from 'zod';

const panelList = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.enum(['t2o', 'mfr', 'mho'])));

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
  FIELD_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
  /** Separate key for keyed hashes used for matching (HMAC-SHA256), so hashes cannot be brute-forced without it. */
  PII_HASH_KEY: z.string().min(32),
  /** Require TOTP MFA for every admin login. Defaults on; tests and local demo may turn it off. */
  REQUIRE_MFA: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AUTH_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
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
  DEMO_POPULATION_SIZE: z.coerce.number().int().positive().default(1500),
});
export type ApiEnv = z.infer<typeof ApiEnv>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const parsed = ApiEnv.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid API configuration: ${issues}`);
  }
  return parsed.data;
}
