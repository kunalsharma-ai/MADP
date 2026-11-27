/**
 * The MADP Panel API Contract.
 *
 * One contract for every panel MADP works with: T2O, MFR, MHO, and any panel or panel network added later from the
 * console. A panel that serves these routes with these shapes and this signing works with MADP, whatever code it runs.
 *
 * The contract follows the T2O backend's own API concepts as far as possible (the owner's decision, 2026-11-27):
 * routes under `/api/v1`, singular resource names for the T2O read routes (`/question`, `/option/:question`,
 * `/profile`, `/user`), the T2O response envelope `{status, message, data}`, a bearer token for the read and sync
 * routes, and the signed `x-madp-*` headers already used by `/api/v1/admin`.
 *
 * Versioning: semantic. `/api/v1` in the path is the panel's own API generation and does not change with the contract.
 * - Patch (1.0.x): wording and documentation only.
 * - Minor (1.x.0): additive. New optional capabilities, routes, fields or query parameters. A panel on 1.0 keeps
 *   working with a MADP that knows 1.3, and the reverse: MADP never calls a capability the panel did not declare.
 * - Major (2.0.0): anything that breaks a 1.x panel. MADP then speaks both majors for at least six months.
 */
export const PANEL_CONTRACT_NAME = 'madp-panel-api' as const;
export const PANEL_CONTRACT_VERSION = '1.1.0' as const;

/** Contract majors this MADP build can talk to. */
export const SUPPORTED_CONTRACT_MAJORS = [1] as const;

/** Sent by MADP on every call, so a panel can log or branch on it. Panels may ignore it. */
export const CONTRACT_VERSION_HEADER = 'x-madp-contract-version' as const;

export function contractMajor(version: string): number | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? Number(m[1]) : null;
}

export function isSupportedContractVersion(version: string): boolean {
  const major = contractMajor(version);
  return major !== null && (SUPPORTED_CONTRACT_MAJORS as readonly number[]).includes(major);
}
