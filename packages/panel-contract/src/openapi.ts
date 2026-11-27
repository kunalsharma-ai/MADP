import { z } from 'zod';
import { CAPABILITIES, type CapabilityInfo } from './capabilities.js';
import { Discovery } from './discovery.js';
import { OPERATIONS, type Operation } from './operations.js';
import {
  AnswerRecord,
  ErrorEnvelope,
  MemberAnswerMap,
  MemberRecord,
  OptionRecord,
  ProfileRecord,
  QuestionRecord,
  ResponseRecord,
  RewardRecord,
  TombstoneRecord,
} from './records.js';
import { PANEL_CONTRACT_NAME, PANEL_CONTRACT_VERSION } from './version.js';

const schema = (s: z.ZodType) =>
  z.toJSONSchema(s, { target: 'openapi-3.0', io: 'output', unrepresentable: 'any' } as never);
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const envelope = (data: unknown) => ({
  type: 'object',
  required: ['status', 'data'],
  properties: { status: { type: 'string', enum: ['success'] }, message: { type: 'string' }, data },
});
const page = (item: string) => ({
  type: 'object',
  required: ['items'],
  properties: {
    items: { type: 'array', items: ref(item) },
    cursor: {
      type: 'string',
      nullable: true,
      description: 'Opaque. Send it back unchanged for the next page.',
    },
    more: { type: 'boolean', description: 'False when the feed is caught up.' },
  },
});

const FEED_ITEM: Record<string, string> = {
  changesMembers: 'Member',
  changesAnswers: 'Answer',
  changesDeletions: 'Tombstone',
  changesRewards: 'Reward',
  changesResponses: 'Response',
};

function answerSchema(op: Operation): unknown {
  switch (op.answer) {
    case 'discovery':
      return envelope(ref('Discovery'));
    case 'questions':
      return envelope({ type: 'array', items: ref('Question') });
    case 'options':
      return envelope({ type: 'array', items: ref('Option') });
    case 'profiles':
      return envelope({ type: 'array', items: ref('Profile') });
    case 'members':
      return envelope({ type: 'array', items: ref('Member') });
    case 'answerMap':
      return envelope(ref('MemberAnswerMap'));
    case 'changes':
      return envelope(page(FEED_ITEM[op.resource]!));
    case 'adminList':
      return envelope({
        oneOf: [
          { type: 'array', items: { type: 'object' } },
          { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } } },
        ],
      });
    default:
      return envelope({
        type: 'object',
        description: 'As served by the reference implementation (shared panel backend).',
      });
  }
}

/** OpenAPI 3.1 document of the contract, generated from the operations table and record schemas. */
export function panelContractOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const cap = CAPABILITIES[op.capability] as CapabilityInfo;
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: op.enums?.[name!] ? { type: 'string', enum: op.enums[name!] } : { type: 'string' },
    }));
    const query = (op.query ?? []).map((name) => ({
      name,
      in: 'query',
      required: false,
      schema: { type: 'string' },
    }));
    paths[op.path] ??= {};
    paths[op.path]![op.method.toLowerCase()] = {
      operationId: op.id,
      summary: op.summary,
      tags: [op.capability],
      'x-madp-capability': op.capability,
      'x-madp-writes': op.writes,
      ...(cap.personal ? { 'x-madp-personal-data': true } : {}),
      security:
        op.auth === 'bearer'
          ? [{ bearer: [] }]
          : op.auth === 'signed'
            ? [{ madpSigned: [] }]
            : [{ bearer: [] }, { madpSigned: [] }],
      parameters: [...params, ...query],
      ...(op.writes
        ? {
            requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } },
          }
        : {}),
      responses: {
        200: { description: 'Success', content: { 'application/json': { schema: answerSchema(op) } } },
        401: {
          description: 'Credentials missing, wrong, stale or replayed',
          content: { 'application/json': { schema: ref('Error') } },
        },
        404: {
          description: 'Not found, or the capability is not offered',
          content: { 'application/json': { schema: ref('Error') } },
        },
        default: { description: 'Error', content: { 'application/json': { schema: ref('Error') } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'MADP Panel API Contract',
      version: PANEL_CONTRACT_VERSION,
      'x-contract': PANEL_CONTRACT_NAME,
      description:
        'The routes any panel serves to work with MADP. Based on the T2O backend API: routes under /api/v1, the {status, message, data} envelope, a bearer token for read and sync routes and signed x-madp-* headers for /api/v1/admin. A panel declares its capabilities at GET /api/v1/contract and MADP calls only those. See docs/PANEL_API_CONTRACT.md.',
    },
    servers: [{ url: 'https://{panelHost}', variables: { panelHost: { default: 'www.turn2opinion.com' } } }],
    tags: Object.entries(CAPABILITIES).map(([name, c]) => ({
      name,
      description: `${c.title}. ${c.purpose}`,
    })),
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Integration token of the panel (read and sync routes).',
        },
        madpSigned: {
          type: 'apiKey',
          in: 'header',
          name: 'x-madp-signature',
          description:
            'hex HMAC-SHA256(secret, "<x-madp-timestamp>\\n<x-madp-nonce>\\n<METHOD>\\n<path+query>\\n<x-madp-origin>\\n<x-madp-actor>\\n<sha256 hex of body>"). Timestamp within 300 s; each nonce (32 hex) accepted once.',
        },
      },
      schemas: {
        Error: schema(ErrorEnvelope),
        Discovery: schema(Discovery),
        Question: schema(QuestionRecord),
        Option: schema(OptionRecord),
        Profile: schema(ProfileRecord),
        Member: schema(MemberRecord),
        Answer: schema(AnswerRecord),
        Tombstone: schema(TombstoneRecord),
        Reward: schema(RewardRecord),
        Response: schema(ResponseRecord),
        MemberAnswerMap: schema(MemberAnswerMap),
      },
    },
    paths,
  };
}

/** The route table of docs/panel-contract/ROUTES.md, generated from the operations table. */
export function panelContractRoutesMarkdown(): string {
  const lines = [
    '# MADP Panel API Contract: every route',
    '',
    `Generated from \`packages/panel-contract/src/operations.ts\` (contract ${PANEL_CONTRACT_VERSION}). Do not edit by hand:`,
    'run `pnpm --filter @madp/panel-contract build && pnpm --filter @madp/panel-contract openapi`.',
    '',
    'Auth: `bearer` = sync token, `signed` = x-madp-* signature, `either` = one of them. Personal = returns member data.',
    '',
  ];
  let cap = '';
  for (const op of [...OPERATIONS].sort((a, b) => a.capability.localeCompare(b.capability))) {
    if (op.capability !== cap) {
      cap = op.capability;
      const c = CAPABILITIES[op.capability] as CapabilityInfo;
      lines.push(
        '',
        `## \`${cap}\` ${c.title}${c.core ? ' (core)' : ''}`,
        '',
        c.purpose,
        '',
        '| Method | Path | Auth | Writes | Personal | What it does |',
        '|---|---|---|---|---|---|',
      );
    }
    const c = CAPABILITIES[op.capability] as CapabilityInfo;
    lines.push(
      `| ${op.method} | \`${op.path}\` | ${op.auth} | ${op.writes ? 'yes' : ''} | ${c.personal ? 'yes' : ''} | ${op.summary} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
