import type {
  AudienceCategory,
  CapabilityFinding,
  ConnectorHealth,
  CountsResponse,
  DataMode,
  PanelCode,
  SessionUser,
} from '@madp/contracts';
export type { SessionUser };

export interface DashboardSummary {
  dataMode: DataMode;
  connectors: { panel: PanelCode; dataMode: DataMode; reason: string }[];
  counts: CountsResponse;
  kpis: {
    verifiedPeople: number;
    multiPanelPeople: number;
    newRegistrationsLast30Days: number;
    pendingMappings: number;
    pendingIdentityMatches: number;
  };
  questionsByPanel: Partial<Record<PanelCode, number>>;
  answersByPanel: Partial<Record<PanelCode, number>>;
  registrationsByMonth: { month: string; panel: PanelCode; n: number }[];
}

export interface ConnectorRow {
  panel: PanelCode;
  name: string;
  shortName: string;
  sensitive: boolean;
  sourceRepository: string;
  dataMode: DataMode;
  reason: string;
  health: ConnectorHealth;
  capabilities: CapabilityFinding[];
  lastJob: ImportJob | null;
  lastSuccessAt: string | null;
  pendingCursor: string | null;
}

export interface SyncStatus {
  intervalMinutes: number;
  panels: {
    panel: PanelCode;
    dataMode: DataMode;
    scheduled: boolean;
    feedFinding: { capability: string; status: string; evidence: string } | null;
    lastRun: {
      id: string;
      status: string;
      startedAt: string | null;
      finishedAt: string | null;
      error: string | null;
      counts: Record<string, unknown>;
    } | null;
    lastSucceededAt: string | null;
    streams: { stream: string; lastSuccessAt: string | null }[];
    parkedAnswerBatches: number;
  }[];
}

export interface ImportJob {
  id: string;
  panel: PanelCode;
  dataMode: DataMode;
  kind: string;
  dryRun: boolean;
  status: string;
  counts: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface QuestionRow {
  panel: PanelCode;
  sourceQuestionId: string;
  label: string;
  type: string | null;
  parent: string | null;
  sourceCategories: string[];
  questionnaires: string[];
  sensitivity: 'standard' | 'special_category';
  version: number;
  versions: number;
  optionCount: number;
  mapping: {
    id: string;
    status: string;
    attributeKey: string | null;
    suggestedAttributeKey: string | null;
  } | null;
}

export interface MappingRow {
  id: string;
  panel: PanelCode;
  sourceQuestionId: string;
  questionVersion: number;
  suggestedAttributeKey: string | null;
  suggestionBasis: string | null;
  attributeKey: string | null;
  status: string;
  notes: string | null;
  valueMap: Record<string, string> | null;
  label: string | null;
  sensitivity: string | null;
  sampleOptions: { value: string; label: string }[];
}

export interface Attribute {
  key: string;
  label: string;
  category: AudienceCategory | null;
  valueType: string;
  sensitivity: string;
  description: string;
}

export interface PanellistRow {
  id: string;
  country: string | null;
  state: string | null;
  city: string | null;
  birthYear: number | null;
  gender: string | null;
  panels: PanelCode[];
  categories: AudienceCategory[];
  emailMasked: string | null;
  emailVerified: boolean;
  memberships: { panel: PanelCode; status: string }[];
  minor: boolean;
  guardianConsent: 'granted' | 'unknown' | 'denied' | 'withdrawn' | null;
}

export interface PanellistDetail {
  dataMode: DataMode;
  person: {
    id: string;
    country: string | null;
    state: string | null;
    city: string | null;
    birthYear: number | null;
    gender: string | null;
    createdAt: string;
  };
  access: { pii: boolean; healthSensitive: boolean; healthPurposeRequired: boolean; purpose: string | null };
  identities: {
    id: string;
    panel: PanelCode;
    sourceMemberId: string;
    sourceRespondentRef: string | null;
    sourceCategory: string;
    email: string | null;
    name: string | null;
    dateOfBirth: string | null;
    emailVerification: string;
    phoneVerification: string;
    qualityScore: number | null;
    sourceActive: boolean;
    sourceCreatedAt: string | null;
    sourceUpdatedAt: string | null;
  }[];
  memberships: { panel: PanelCode; status: string; joinedAt: string | null }[];
  categories: { panel: PanelCode; category: AudienceCategory; basis: string; isMinor: boolean }[];
  consents: {
    panel: PanelCode;
    purpose: string;
    status: 'granted' | 'denied' | 'withdrawn' | 'unknown';
    channel: string | null;
    version: string | null;
    capturedAt: string | null;
  }[];
  identityCandidates: { id: string; rule: string; status: string; createdAt: string }[];
  answers: {
    panel: PanelCode;
    sourceQuestionId: string;
    label: string | null;
    questionVersion: number;
    values: string[];
    sensitivity: string;
    sourceUpdatedAt: string | null;
    ingestedAt: string;
  }[];
  hiddenSensitiveAnswers: number;
  hiddenMinorAnswers: number;
}

export interface AuditRow {
  id: number;
  at: string;
  actorId: string | null;
  actorType: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  actorRole: string | null;
  panel: 't2o' | 'mfr' | 'mho' | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  hash: string;
}
