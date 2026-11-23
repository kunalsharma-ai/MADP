import type { CapabilityFinding, PanelCode } from '@madp/contracts';

/**
 * Capability findings from the read-only repository audits (docs/REPOSITORY_AUDIT_*.md).
 * "verified" = read in the source code; it still needs a live, authorised contract test before
 * the acceptance matrix can mark it passed.
 */
export const AUDITED_CAPABILITIES: Record<PanelCode, CapabilityFinding[]> = {
  t2o: [
    { capability: 'questions.read', status: 'verified', evidence: 'GET /api/v1/question (no auth) - backend/app/routes/api/Question.js' },
    { capability: 'options.read', status: 'verified', evidence: 'GET /api/v1/option/:parent (no auth) - routes/api/Option.js' },
    { capability: 'questionnaires.read', status: 'verified', evidence: 'GET /api/v1/profile (no auth) - routes/api/Profile.js; pages = arrays of Question.name' },
    { capability: 'respondents.read', status: 'partial', evidence: 'POST /api/v1/user (isAuthenticated only, body passed to Mongo as filter) - routes/api/User.js:189' },
    { capability: 'respondents.pagination', status: 'missing', evidence: 'CrudController.list has no limit/skip - utils/crudController.js' },
    { capability: 'respondents.updatedSince', status: 'partial', evidence: 'timestamps:true on every model; only reachable via the raw filter body (not a supported contract)' },
    { capability: 'answers.read', status: 'partial', evidence: 'GET /api/v1/user/:id/profile (isAuthenticated only) - routes/api/User.js:1096' },
    { capability: 'answers.updatedSince', status: 'missing', evidence: 'No endpoint filters Answer by updatedAt' },
    { capability: 'consent.read', status: 'partial', evidence: 'User.consent{canShareVideo,canShareGPS,canAcceptPushNotification}, User.terms[], User.parent.consentStatus (teens)' },
    { capability: 'deletions.read', status: 'missing', evidence: 'DELETE /api/v1/user/:id hard-deletes; no tombstone or event' },
    { capability: 'rewards.read', status: 'partial', evidence: 'Rewards model (express-web-tools MongooseModel) + Response.points; GET /api/v1/me/rewards is member-scoped' },
    { capability: 'webhooks', status: 'missing', evidence: 'No webhook emitter in backend' },
    { capability: 'questions.write', status: 'verified', evidence: 'PUT /api/v1/question (NO auth check) - routes/api/Question.js' },
    { capability: 'serviceAccountAuth', status: 'partial', evidence: 'POST /api/v1/user/apps issues a 365-day token for a role=root "app" user matched by request body (no secret) - see SECURITY finding T2O-SEC-01' },
  ],
  mfr: [
    { capability: 'questions.read', status: 'verified', evidence: 'GET /api/v1/question - api/app/routes/api/Question.js' },
    { capability: 'options.read', status: 'verified', evidence: 'GET /api/v1/option/:parent - routes/api/Option.js' },
    { capability: 'questionnaires.read', status: 'verified', evidence: 'GET /api/v1/profile - routes/api/Profile.js' },
    { capability: 'respondents.read', status: 'verified', evidence: 'POST /api/v1/user (requireAdmin, safeFilter) - routes/api/User.js:60, utils/access.js' },
    { capability: 'respondents.pagination', status: 'missing', evidence: 'CrudController.list has no limit/skip' },
    { capability: 'respondents.updatedSince', status: 'partial', evidence: 'safeFilter() body filter; operator support must be confirmed' },
    { capability: 'answers.read', status: 'verified', evidence: 'POST /api/v1/user/:user/profile-data {questions:[...]} (selfOrAdmin) - routes/api/User.js:242' },
    { capability: 'answers.updatedSince', status: 'missing', evidence: 'No endpoint filters Answer by updatedAt' },
    { capability: 'consent.read', status: 'partial', evidence: 'User.consent, MemberPreference.notifications, answers "terms-consent"/"news-letter", TeenConsent model' },
    { capability: 'deletions.read', status: 'partial', evidence: 'DataRequest model (manual review, kind=delete) - api/app/model/DataRequest.js' },
    { capability: 'rewards.read', status: 'partial', evidence: 'engagement/ledger.js derives ledger from Response + Reward + PointsHold; member-scoped routes' },
    { capability: 'webhooks', status: 'missing', evidence: 'No webhook emitter' },
    { capability: 'questions.write', status: 'verified', evidence: 'PUT /api/v1/question (no auth check) - routes/api/Question.js' },
    { capability: 'serviceAccountAuth', status: 'missing', evidence: 'No /user/apps route; only member JWT (7d) with an admin role' },
  ],
  mho: [
    { capability: 'questions.read', status: 'verified', evidence: 'GET /api/v1/question - backend/app/routes/api/Question.js' },
    { capability: 'options.read', status: 'verified', evidence: 'GET /api/v1/option/:parent - routes/api/Option.js' },
    { capability: 'questionnaires.read', status: 'verified', evidence: 'GET /api/v1/profile; exports in Project/sections/hcp/data-source' },
    { capability: 'respondents.read', status: 'unknown', evidence: 'Repo: POST /api/v1/user (isAdmin). But docker-compose runs image turn2opinion/backend:1.0.1 with only controller/Profile.js and new-module mounted, so deployed routes may be T2O code' },
    { capability: 'respondents.pagination', status: 'missing', evidence: 'CrudController.list has no limit/skip' },
    { capability: 'respondents.updatedSince', status: 'unknown', evidence: 'Depends on deployed image' },
    { capability: 'answers.read', status: 'unknown', evidence: 'Repo: POST /api/v1/user/:user/profile-data (isAdmin); deployed image unverified' },
    { capability: 'answers.updatedSince', status: 'missing', evidence: 'No endpoint filters Answer by updatedAt' },
    { capability: 'consent.read', status: 'partial', evidence: 'User.consent, User.terms[], parent consent for "minor patient"' },
    { capability: 'deletions.read', status: 'missing', evidence: 'No deletion request model in MHO backend' },
    { capability: 'rewards.read', status: 'partial', evidence: 'Rewards model with Pending/Approved/Rejected + balance - backend/app/model/Rewards.js' },
    { capability: 'webhooks', status: 'missing', evidence: 'In-process EventEmitter only (Project/utils/EventStream.js), no outbound delivery' },
    { capability: 'questions.write', status: 'verified', evidence: 'PUT /api/v1/question (no auth check)' },
    { capability: 'serviceAccountAuth', status: 'missing', evidence: 'No /user/apps route in MHO repo' },
  ],
};
