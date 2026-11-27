import { z } from 'zod';
import {
  ConsentCheck,
  CountsRequest,
  CountsResponse,
  InvitationAuthorize,
  LoginRequest,
  MatchRequest,
  ParticipationEvents,
  ReservationCreate,
  ServiceClientCreate,
  ServiceCountsRequest,
  SessionUser,
  ContactPreferenceCreate,
  PrivacyRequestCreate,
  PrivacyStep,
  EvidenceCreate,
  EvidenceDecision,
  EvidenceRevoke,
  InsightDecision,
  GeoRequest,
} from '@madp/contracts';

// Request bodies are described as the client sends them (before transforms such as lower-casing).
const json = (s: z.ZodType) => z.toJSONSchema(s, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' } as never);
const ok = (description: string, schema?: z.ZodType) => ({
  200: { description, ...(schema ? { content: { 'application/json': { schema: json(schema) } } } : {}) },
});
const secured = [{ bearerAuth: [] }];
const signed = [{ madpClient: [], madpSignature: [] }];
const body = (schema: z.ZodType) => ({ content: { 'application/json': { schema: json(schema) } } });
const service = (summary: string, scope: string, schema?: z.ZodType, writes = false) => ({
  security: signed,
  summary: `${summary} (scope ${scope})`,
  ...(writes ? { parameters: [{ name: 'idempotency-key', in: 'header', required: false, schema: { type: 'string' } }] } : {}),
  ...(schema ? { requestBody: body(schema) } : {}),
  responses: ok(summary),
});

/** OpenAPI 3.1 document for the endpoints implemented so far (generated from the shared zod contracts). */
export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MADP API',
      version: '1.1.0-m6',
      description:
        'Master Audience Data Platform. Every audience response states its dataMode (demo | live).',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        madpClient: { type: 'apiKey', in: 'header', name: 'x-madp-client', description: 'Service client id (Supply360)' },
        madpSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-madp-signature',
          description:
            'v1=<hex HMAC-SHA256(secret, "<ts>.<nonce>.<METHOD>.<path>.<sha256 hex of body>")>, with x-madp-timestamp (unix seconds, ±300 s) and x-madp-nonce (used once).',
        },
      },
    },
    paths: {
      '/health': { get: { summary: 'Liveness and datastore status', responses: ok('Status') } },
      '/auth/login': {
        post: {
          summary: 'Admin sign-in (password + TOTP)',
          requestBody: { content: { 'application/json': { schema: json(LoginRequest) } } },
          responses: ok('Session token'),
        },
      },
      '/auth/me': {
        get: { security: secured, summary: 'Current admin', responses: ok('Session user', SessionUser) },
      },
      '/auth/mfa/setup': {
        post: { security: secured, summary: 'Begin TOTP enrolment', responses: ok('otpauth URI') },
      },
      '/auth/mfa/confirm': {
        post: { security: secured, summary: 'Confirm TOTP enrolment', responses: ok('Full-scope session') },
      },
      '/audience/counts': {
        post: {
          security: secured,
          summary: 'Unique-person, membership and category counts with minimum cell suppression',
          requestBody: { content: { 'application/json': { schema: json(CountsRequest) } } },
          responses: ok('Counts', CountsResponse),
        },
      },
      '/audience/attributes': {
        get: { security: secured, summary: 'Canonical attribute catalogue', responses: ok('Attributes') },
      },
      '/integrations/health': {
        get: { security: secured, summary: 'Per-panel connector health', responses: ok('Health') },
      },
      '/connectors': {
        get: {
          security: secured,
          summary: 'Connector mode, capabilities, last import',
          responses: ok('Connectors'),
        },
      },
      '/connectors/{panel}/import': {
        post: {
          security: secured,
          summary: 'Run a backfill/reconciliation import (dryRun defaults to true)',
          responses: ok('Import result'),
        },
      },
      '/imports': { get: { security: secured, summary: 'Recent import jobs', responses: ok('Jobs') } },
      '/questions': {
        get: {
          security: secured,
          summary: 'Question registry (latest versions)',
          responses: ok('Questions'),
        },
      },
      '/questions/{panel}/{sourceQuestionId}': {
        get: { security: secured, summary: 'All versions of a source question', responses: ok('Versions') },
      },
      '/mappings/review': {
        get: { security: secured, summary: 'Mapping review queue', responses: ok('Queue') },
      },
      '/mappings/{id}/decision': {
        post: {
          security: secured,
          summary: 'Approve / reject / request info on a mapping',
          responses: ok('Updated mapping'),
        },
      },
      '/identity/candidates': {
        get: { security: secured, summary: 'Cross-panel match candidates (masked; audited)', responses: ok('Queue') },
      },
      '/identity/candidates/{id}/decision': {
        post: { security: secured, summary: 'Approve (merge) or reject a match', responses: ok('Decision') },
      },
      '/identity/source-identities/{id}/unlink': {
        post: { security: secured, summary: 'Unmerge one panel identity from its person', responses: ok('Result') },
      },
      '/identity/persons/{id}/history': {
        get: { security: secured, summary: 'Merge and unmerge history of a person', responses: ok('Events') },
      },
      '/panellists': {
        get: {
          security: secured,
          summary: 'Panellist directory (masked, keyset paginated)',
          responses: ok('Page'),
        },
      },
      '/panellists/{id}': {
        get: {
          security: secured,
          summary: '360 profile (PII and health data by permission; audited)',
          responses: ok('Profile'),
        },
      },
      '/new-members': {
        get: { security: secured, summary: 'New sign-ups per panel and segment since last seen (counts only)', responses: ok('Summary') },
      },
      '/new-members/seen': {
        post: { security: secured, summary: "Mark a panel's new sign-ups as seen for this admin", responses: ok('Seen') },
      },
      '/fraud-alerts': {
        get: { security: secured, summary: 'Possible duplicate accounts per panel (same phone, e-mail, or name and birth date); counts only', responses: ok('Alerts') },
      },
      '/fraud-alerts/seen': {
        post: { security: secured, summary: "Mark a panel's duplicate alerts as seen for this admin", responses: ok('Seen') },
      },
      '/member-views': {
        get: { security: secured, summary: "Saved Members-table views for the picked brand: the admin's own and shared ones", responses: ok('Views') },
        post: { security: secured, summary: 'Save the current filters and sort under a name (filters only, no personal data)', responses: ok('Saved') },
      },
      '/member-views/{id}': {
        delete: { security: secured, summary: 'Delete one of your saved views', responses: ok('Deleted') },
      },
      '/dashboard/summary': {
        get: { security: secured, summary: 'Executive KPIs', responses: ok('Summary') },
      },
      '/audit': { get: { security: secured, summary: 'Audit trail', responses: ok('Events') } },
      '/service-clients': {
        get: { security: secured, summary: 'Supply360 service clients with activity counts', responses: ok('Clients') },
        post: { security: secured, summary: 'Create a service client (secret shown once)', requestBody: body(ServiceClientCreate), responses: ok('Client') },
      },
      '/service-clients/{id}/revoke': { post: { security: secured, summary: 'Revoke a service client', responses: ok('Client') } },
      // Screens 2 to 4, 8, 13, 14, 15, 23, 29 and 34 (admin session; brand from x-madp-brand where noted).
      '/audience/geo': { post: { security: secured, summary: 'Unique people by country, state or city (audience.counts.read)', requestBody: body(GeoRequest), responses: ok('GeoResponse') } },
      '/audience/overlap': { post: { security: secured, summary: 'Panel combinations and category overlap (audience.counts.read)', requestBody: body(CountsRequest), responses: ok('OverlapResponse') } },
      '/consent/summary': { get: { security: secured, summary: 'Consent and reachability funnel per panel (consent.read)', responses: ok('Summary') } },
      '/consent/events': { get: { security: secured, summary: 'Append-only consent history (consent.read)', responses: ok('Events') } },
      '/consent/preferences': { get: { security: secured, summary: 'Channel opt-outs recorded in MADP (consent.read)', responses: ok('Preferences') } },
      '/consent/persons/{personId}': { get: { security: secured, summary: "A person's consent, audited (consent.read)", responses: ok('Person consent') } },
      '/consent/persons/{personId}/preferences': { post: { security: secured, summary: 'Record or lift a channel opt-out (consent.manage)', requestBody: body(ContactPreferenceCreate), responses: ok('Preference') } },
      '/privacy/requests': {
        get: { security: secured, summary: 'Privacy requests with due dates (privacy.read)', responses: ok('Requests') },
        post: { security: secured, summary: 'Log a privacy request (privacy.request)', requestBody: body(PrivacyRequestCreate), responses: ok('Request') },
      },
      '/privacy/requests/{id}': { get: { security: secured, summary: 'One request and its trail (privacy.read)', responses: ok('Request') } },
      '/privacy/requests/{id}/verify': { post: { security: secured, summary: 'Verify the requester; not by whoever logged it (privacy.execute)', requestBody: body(PrivacyStep), responses: ok('Request') } },
      '/privacy/requests/{id}/execute': { post: { security: secured, summary: 'Carry out; deletion erases MADP copy and holds the member (privacy.execute)', requestBody: body(PrivacyStep), responses: ok('Request') } },
      '/privacy/requests/{id}/reject': { post: { security: secured, summary: 'Reject (privacy.execute)', requestBody: body(PrivacyStep), responses: ok('Request') } },
      '/privacy/requests/{id}/complete': { post: { security: secured, summary: 'Complete (privacy.execute)', requestBody: body(PrivacyStep), responses: ok('Request') } },
      '/privacy/requests/{id}/export': { get: { security: secured, summary: 'Access export, audited (privacy.execute + PII + health)', responses: ok('Export') } },
      '/privacy/retention': { get: { security: secured, summary: 'Retention schedule (privacy.read)', responses: ok('Rules') } },
      '/privacy/retention/{key}/purge': { post: { security: secured, summary: 'Purge a purgeable technical table (privacy.execute)', responses: ok('Removed rows') } },
      '/profiles/freshness': { get: { security: secured, summary: 'Profile completeness and 6-month check (audience.counts.read)', responses: ok('Freshness') } },
      '/verification/summary': { get: { security: secured, summary: 'Verification and data quality per panel (verification.read; x-madp-brand)', responses: ok('Summary') } },
      '/verification/checks': { get: { security: secured, summary: 'Members failing a check, ids only (verification.read + panellists.read)', responses: ok('Drill-down') } },
      '/verification/evidence': {
        get: { security: secured, summary: 'Verification evidence (verification.read)', responses: ok('Evidence') },
        post: { security: secured, summary: 'Record evidence for review (verification.review)', requestBody: body(EvidenceCreate), responses: ok('Evidence') },
      },
      '/verification/evidence/{id}/decision': { post: { security: secured, summary: 'Verify or reject; not by the recorder (verification.review)', requestBody: body(EvidenceDecision), responses: ok('Evidence') } },
      '/verification/evidence/{id}/revoke': { post: { security: secured, summary: 'Revoke verified evidence (verification.review)', requestBody: body(EvidenceRevoke), responses: ok('Evidence') } },
      '/reports': { get: { security: secured, summary: 'Report catalogue with view and export rights (reports.read; x-madp-brand)', responses: ok('Catalogue') } },
      '/reports/{key}': { get: { security: secured, summary: "Run a report (reports.read + the report's permission)", responses: ok('ReportResult') } },
      '/reports/{key}/export': { get: { security: secured, summary: 'CSV or XLSX download, audited (export.read)', responses: ok('File') } },
      '/insights': { get: { security: secured, summary: 'Rule-based insights (insights.read; x-madp-brand)', responses: ok('Insights') } },
      '/insights/refresh': { post: { security: secured, summary: 'Run the rules (insights.review)', responses: ok('Raised, updated, resolved') } },
      '/insights/{id}/decision': { post: { security: secured, summary: 'Accept or dismiss (insights.review)', requestBody: body(InsightDecision), responses: ok('Insight') } },
      '/supply360/attributes': { get: service('Attribute catalogue (no special-category keys without health.aggregate)', 'attributes.read') },
      '/supply360/counts': { post: service('Aggregate counts with small-cell suppression', 'audience.counts', ServiceCountsRequest) },
      '/supply360/match': { post: service('Eligible members as pseudonymous refs, no personal data', 'audience.match', MatchRequest) },
      '/supply360/reservations': { post: service('Hold members for a project, at most 14 days', 'reservations.write', ReservationCreate, true) },
      '/supply360/reservations/{id}': {
        get: service('Reservation status', 'reservations.write'),
        delete: service('Release a reservation', 'reservations.write'),
      },
      '/supply360/invitations/authorize': { post: service('Authorise invitations against consent and contact rules', 'invitations.authorize', InvitationAuthorize, true) },
      '/supply360/participation/events': { post: service('Participation events, each event id once', 'participation.write', ParticipationEvents, true) },
      '/supply360/consent/check': { post: service('Consent state per ref and purpose', 'consent.check', ConsentCheck) },
      '/supply360/integrations/health': { get: service('Status of the client’s panels', 'integrations.health') },
    },
  };
}
