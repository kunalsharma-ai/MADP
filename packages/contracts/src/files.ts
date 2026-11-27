import { z } from 'zod';
import type { Permission } from './auth.js';

/**
 * Downloads and uploads across the console. A download turns the table an admin is looking at into Excel, CSV, PDF or
 * Word. It holds only what the screen already shows (masking, teen hiding and MHO health rules were applied when the
 * page loaded), carries the data mode, needs `export.read` (plus `export.pii` on screens with personal data) and is
 * audited. An upload is parsed into rows or document blocks first; nothing is written until the admin applies the
 * preview through the screen's own audited route.
 */
export const FILE_FORMATS = ['xlsx', 'csv', 'pdf', 'docx'] as const;
export const FileFormat = z.enum(FILE_FORMATS);
export type FileFormat = z.infer<typeof FileFormat>;

export const FILE_FORMAT_LABEL: Record<FileFormat, string> = {
  xlsx: 'Excel',
  csv: 'CSV',
  pdf: 'PDF',
  docx: 'Word',
};

/**
 * Every console screen that offers a download. `pii`: the table can show names, e-mails or phone numbers (masked or
 * not), so the file also needs `export.pii`. `needs`: the permission the screen itself needs to read the data.
 */
export const EXPORT_SCREENS = {
  activity: { title: 'Live activity', pii: true, needs: 'members.read' },
  admins: { title: 'Admins', pii: true, needs: 'admins.manage' },
  audience_segments: { title: 'Audience segments', pii: false, needs: null },
  audit: { title: 'Audit log', pii: true, needs: 'audit.read' },
  automations: { title: 'Automations', pii: false, needs: null },
  connectors: { title: 'Connectors and syncs', pii: false, needs: null },
  connector_import: { title: 'Import run', pii: false, needs: null },
  consent: { title: 'Consent', pii: true, needs: null },
  content: { title: 'Content pages', pii: false, needs: 'content.manage' },
  content_page: { title: 'Content page', pii: false, needs: 'content.manage' },
  data_requests: { title: 'Data requests', pii: true, needs: 'data_requests.manage' },
  duplicates: { title: 'Duplicate members', pii: true, needs: 'members.read' },
  engagement: { title: 'Engagement', pii: false, needs: null },
  experts: { title: 'Expert verification', pii: true, needs: 'members.read' },
  freshness: { title: 'Profile freshness', pii: false, needs: null },
  geo: { title: 'Geo explorer', pii: false, needs: null },
  help_centre: { title: 'Help centre', pii: false, needs: 'content.manage' },
  mailers: { title: 'Mailer library', pii: false, needs: null },
  mappings: { title: 'Mappings', pii: false, needs: null },
  member: { title: 'Member', pii: true, needs: 'members.read' },
  member_engagement: { title: 'Member engagement', pii: true, needs: 'members.read' },
  members: { title: 'Members', pii: true, needs: 'members.read' },
  messages: { title: 'Portal messages', pii: false, needs: 'support.read' },
  networks: { title: 'Panel networks', pii: false, needs: null },
  panellist: { title: 'Panellist', pii: true, needs: null },
  panellists: { title: 'Panellists', pii: true, needs: null },
  participation: { title: 'Survey participation', pii: true, needs: null },
  points: { title: 'Points', pii: true, needs: null },
  privacy: { title: 'Privacy requests', pii: true, needs: null },
  prize_machines: { title: 'Prize machines', pii: false, needs: null },
  profiles: { title: 'Profiles', pii: false, needs: 'qb.read' },
  quality: { title: 'Quality', pii: true, needs: null },
  question_bank: { title: 'Question bank', pii: false, needs: 'qb.read' },
  question: { title: 'Question', pii: false, needs: 'qb.read' },
  questionnaires: { title: 'Questionnaires', pii: false, needs: 'qb.read' },
  questionnaire: { title: 'Questionnaire', pii: false, needs: 'qb.read' },
  questions: { title: 'Question registry', pii: false, needs: null },
  rewards: { title: 'Rewards', pii: true, needs: null },
  segments: { title: 'Segments', pii: false, needs: null },
  supply360: { title: 'Supply360', pii: false, needs: null },
  surveys: { title: 'Surveys', pii: false, needs: null },
  survey: { title: 'Survey', pii: true, needs: null },
  switches: { title: 'Feature switches', pii: false, needs: 'switches.read' },
  teens: { title: 'Teens', pii: true, needs: 'teen.read' },
  teen_registrations: { title: 'Teen registrations', pii: true, needs: 'teen.read' },
  tickets: { title: 'Ticket desk', pii: true, needs: 'support.read' },
  translations: { title: 'Translations', pii: false, needs: 'qb.read' },
  verification: { title: 'Verification', pii: true, needs: null },
  verification_summary: { title: 'Verification summary', pii: false, needs: null },
} as const satisfies Record<string, { title: string; pii: boolean; needs: Permission | null }>;
export type ExportScreen = keyof typeof EXPORT_SCREENS;
export const ExportScreen = z.enum(Object.keys(EXPORT_SCREENS) as [ExportScreen, ...ExportScreen[]]);

export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_MAX_COLUMNS = 40;

const Cell = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()]);
export type ExportCell = z.infer<typeof Cell>;

export const ExportColumn = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'number', 'date', 'money']).default('text'),
});
export type ExportColumn = z.input<typeof ExportColumn>;

export const TableExportRequest = z
  .object({
    screen: ExportScreen,
    format: FileFormat,
    title: z.string().trim().min(1).max(160),
    /** Filters or scope the admin had on screen, printed on the file ("Status: open, Search: refund"). */
    subtitle: z.string().trim().max(400).optional(),
    columns: z.array(ExportColumn).min(1).max(EXPORT_MAX_COLUMNS),
    rows: z.array(z.record(z.string(), Cell)).max(EXPORT_MAX_ROWS),
  })
  .refine(
    (r) => new Set(r.columns.map((c) => c.key)).size === r.columns.length,
    'column keys must be unique',
  );
export type TableExportRequest = z.input<typeof TableExportRequest>;

/** Upload parsing: a spreadsheet (xlsx or csv) to rows, or a Word file (docx) to page blocks. Nothing is stored. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const FileParseRequest = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['table', 'document']),
  /** The file, base64. */
  data: z
    .string()
    .max(Math.ceil((UPLOAD_MAX_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'base64'),
});
export type FileParseRequest = z.infer<typeof FileParseRequest>;

export interface ParsedTable {
  kind: 'table';
  /** First row is the header. Every cell is text. */
  sheets: { name: string; rows: string[][] }[];
}
/** Blocks in the panel content shape (see ContentBlock): text, h2, h3, ul, ol, note, table. */
export type ParsedBlock =
  | string
  | { h2: string }
  | { h3: string }
  | { note: string }
  | { ul: string[] }
  | { ol: string[] }
  | { table: { head: string[]; rows: string[][] } };
export interface ParsedDocument {
  kind: 'document';
  title: string | null;
  blocks: ParsedBlock[];
  warnings: string[];
}
export type ParsedFile = ParsedTable | ParsedDocument;
