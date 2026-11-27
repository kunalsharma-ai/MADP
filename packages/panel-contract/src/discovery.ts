import { z } from 'zod';
import { CAPABILITY_IDS, CORE_CAPABILITIES, isCapability, type Capability } from './capabilities.js';
import {
  PANEL_CONTRACT_NAME,
  PANEL_CONTRACT_VERSION,
  contractMajor,
  isSupportedContractVersion,
} from './version.js';

/**
 * `GET /api/v1/contract`: what the panel tells MADP about itself. It holds no personal data. It answers either the
 * sync bearer token or a signed admin request (then `brands` may be narrowed to the signed origin).
 */
export const Discovery = z.looseObject({
  contract: z.literal(PANEL_CONTRACT_NAME),
  /** The contract version the panel implements, e.g. `1.0.0`. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'a version like 1.0.0'),
  implementation: z
    .looseObject({
      /** e.g. `t2o-shared-backend`. Free text. */
      name: z.string().min(1).max(100),
      version: z.string().max(50).optional(),
    })
    .optional(),
  /** Brand hostnames this backend serves, as stored in `origin` on its records. */
  brands: z
    .array(z.looseObject({ origin: z.string().min(1).max(255), name: z.string().max(100).optional() }))
    .min(1),
  /** Capability ids (see capabilities.ts). Unknown ids are allowed (a newer minor version) and ignored. */
  capabilities: z.array(z.string().min(1).max(100)).min(1),
  limits: z
    .looseObject({
      /** Largest `limit` a changes feed accepts. MADP never asks for more. */
      maxPageSize: z.number().int().min(1).max(10_000).optional(),
      /** Requests per minute MADP may send. MADP's own minimum gap is 250 ms. */
      requestsPerMinute: z.number().int().min(1).optional(),
    })
    .optional(),
  webhooks: z
    .looseObject({
      /** Event types the panel sends to MADP's `POST /api/v1/webhooks/:panel`. */
      events: z.array(z.string()).default([]),
    })
    .optional(),
});
export type Discovery = z.infer<typeof Discovery>;

export interface DiscoveryCheck {
  ok: boolean;
  discovery?: Discovery;
  /** Declared ids this MADP build knows. */
  capabilities: Capability[];
  /** Declared ids this MADP build does not know (from a newer minor version). */
  unknown: string[];
  /** Core capabilities the panel did not declare. */
  missingCore: Capability[];
  problems: string[];
}

/**
 * Validates a discovery answer: shape, a supported major version and the core capabilities. `requireCore: false` is
 * for a backend that serves only part of a panel (today the signed admin API runs apart from the sync routes); the
 * core check then applies to the union of the panel's backends.
 */
export function checkDiscovery(data: unknown, opts: { requireCore?: boolean } = {}): DiscoveryCheck {
  const parsed = Discovery.safeParse(data);
  if (!parsed.success)
    return {
      ok: false,
      capabilities: [],
      unknown: [],
      missingCore: [...CORE_CAPABILITIES],
      problems: parsed.error.issues.map((i) => `${i.path.join('.') || 'answer'}: ${i.message}`),
    };
  const d = parsed.data;
  const problems: string[] = [];
  if (!isSupportedContractVersion(d.version))
    problems.push(
      `Contract version ${d.version} (major ${contractMajor(d.version)}) is not supported by this MADP`,
    );
  const capabilities = [...new Set(d.capabilities.filter(isCapability))];
  const unknown = d.capabilities.filter((c) => !isCapability(c));
  const missingCore = CORE_CAPABILITIES.filter((c) => !capabilities.includes(c));
  if (missingCore.length && opts.requireCore !== false)
    problems.push(`Missing core capabilities: ${missingCore.join(', ')}`);
  return { ok: problems.length === 0, discovery: d, capabilities, unknown, missingCore, problems };
}

/** A discovery answer for a backend that offers the given capabilities. Used by the reference panel and in docs. */
export function makeDiscovery(p: {
  brands: string[];
  capabilities?: readonly string[];
  implementation?: { name: string; version?: string };
  version?: string;
}): Discovery {
  return {
    contract: PANEL_CONTRACT_NAME,
    version: p.version ?? PANEL_CONTRACT_VERSION,
    ...(p.implementation ? { implementation: p.implementation } : {}),
    brands: p.brands.map((origin) => ({ origin })),
    capabilities: [...(p.capabilities ?? CAPABILITY_IDS)],
  };
}
