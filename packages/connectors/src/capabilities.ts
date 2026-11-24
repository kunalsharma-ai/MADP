import type { CapabilityFinding, PanelCode } from '@madp/contracts';

/**
 * Capability findings from the read-only audits (docs/REPOSITORY_AUDIT_*.md), for the backend each panel
 * actually runs in production.
 * "verified" = read in the source code; it still needs a live, authorised contract test before
 * the acceptance matrix can mark it passed.
 */
/** The T2O backend (Project/backend in the turn2opinion repo). */
const T2O_BACKEND: CapabilityFinding[] = [
  {
    capability: 'questions.read',
    status: 'verified',
    evidence: 'GET /api/v1/question (no auth) - backend/app/routes/api/Question.js',
  },
  {
    capability: 'options.read',
    status: 'verified',
    evidence: 'GET /api/v1/option/:parent (no auth) - routes/api/Option.js',
  },
  {
    capability: 'questionnaires.read',
    status: 'verified',
    evidence: 'GET /api/v1/profile (no auth) - routes/api/Profile.js; pages = arrays of Question.name',
  },
  {
    capability: 'respondents.read',
    status: 'partial',
    evidence:
      'GET /api/v1/user (unpaginated list) - routes/api/User.js:177. Any signed-in member today (T2O-SEC-03); admin-only once the T2O member-access fix is deployed, so MADP needs an admin integration account',
  },
  {
    capability: 'respondents.pagination',
    status: 'missing',
    evidence: 'CrudController.list has no limit/skip - utils/crudController.js',
  },
  {
    capability: 'respondents.updatedSince',
    status: 'partial',
    evidence:
      'timestamps:true on every model. GET /api/v1/changes/members (admin, cursor-paged, incl. deactivated/soft-deleted) is proposed in turn2opinion#20, not deployed',
  },
  {
    capability: 'answers.read',
    status: 'partial',
    evidence: 'GET /api/v1/user/:id/profile (isAuthenticated only) - routes/api/User.js:1096',
  },
  {
    capability: 'answers.updatedSince',
    status: 'partial',
    evidence:
      'GET /api/v1/changes/answers (admin, cursor-paged) is proposed in turn2opinion#20, not deployed',
  },
  {
    capability: 'consent.read',
    status: 'partial',
    evidence:
      'User.consent{canShareVideo,canShareGPS,canAcceptPushNotification}, User.terms[], User.parent.consentStatus (teens)',
  },
  {
    capability: 'deletions.read',
    status: 'partial',
    evidence:
      'DELETE /api/v1/user/:id hard-deletes. turn2opinion#20 (not deployed) writes a Tombstone and serves GET /api/v1/changes/deletions',
  },
  {
    capability: 'rewards.read',
    status: 'partial',
    evidence:
      'Rewards model (express-web-tools MongooseModel) + Response.points; GET /api/v1/me/rewards is member-scoped',
  },
  { capability: 'webhooks', status: 'missing', evidence: 'No webhook emitter in backend' },
  {
    capability: 'questions.write',
    status: 'verified',
    evidence: 'PUT /api/v1/question (NO auth check) - routes/api/Question.js',
  },
  {
    capability: 'serviceAccountAuth',
    status: 'partial',
    evidence:
      'POST /api/v1/user/apps issues a 365-day token for a role=root "app" user matched by request body (no secret) - see SECURITY finding T2O-SEC-01',
  },
];

/**
 * MFR and MHO production run the T2O backend, not the API code in their own repositories: confirmed by the
 * owner on 2026-11-23 for MFR, and for MHO by its docker-compose (turn2opinion/backend:1.0.1) and the shared
 * OpenAPI document. Their repositories' own access checks (e.g. MFR's requireAdmin) therefore do not apply in
 * production. Same routes, separate tenant by Host header.
 */
const onT2oBackend = (panel: string): CapabilityFinding[] =>
  T2O_BACKEND.map((f) => ({
    ...f,
    evidence: `${panel} production runs the T2O backend: ${f.evidence}`,
  }));

export const AUDITED_CAPABILITIES: Record<PanelCode, CapabilityFinding[]> = {
  t2o: T2O_BACKEND,
  mfr: onT2oBackend('MFR'),
  mho: onT2oBackend('MHO'),
};
