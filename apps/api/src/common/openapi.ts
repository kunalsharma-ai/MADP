import { z } from 'zod';
import { CountsRequest, CountsResponse, LoginRequest, SessionUser } from '@madp/contracts';

const json = (s: z.ZodType) => z.toJSONSchema(s, { target: 'openapi-3.0' } as never);
const ok = (description: string, schema?: z.ZodType) => ({
  200: { description, ...(schema ? { content: { 'application/json': { schema: json(schema) } } } : {}) },
});
const secured = [{ bearerAuth: [] }];

/** OpenAPI 3.1 document for the endpoints implemented so far (generated from the shared zod contracts). */
export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MADP API',
      version: '1.0.0-m1',
      description:
        'Master Audience Data Platform. Every audience response states its dataMode (demo | live).',
    },
    servers: [{ url: '/api/v1' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
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
      '/dashboard/summary': {
        get: { security: secured, summary: 'Executive KPIs', responses: ok('Summary') },
      },
      '/audit': { get: { security: secured, summary: 'Audit trail', responses: ok('Events') } },
    },
  };
}
