import type {
  PanelCode,
  SourceOption,
  SourceQuestion,
  SourceQuestionnaire,
  SourceRespondent,
  SourceAnswer,
} from '@madp/contracts';

/** Shapes returned by the shared Express/Mongoose panel backend (`{status, message, data}` envelope). */
export interface RawQuestion {
  _id?: string;
  name: string;
  label?: string;
  type?: string;
  parent?: string | null;
  category?: string[] | string;
  isRequired?: boolean;
  hasOthers?: boolean;
  hasNone?: boolean;
  maxSelections?: string | number;
  updatedAt?: string;
}
export interface RawOption {
  question: string;
  label?: string;
  value?: string;
  parentValue?: string[];
  isExclusive?: boolean;
}
export interface RawProfile {
  slug?: string;
  name: string;
  category: string;
  pages?: string[][];
  points?: number;
}
export interface RawUser {
  _id: string;
  respondentID?: string;
  category?: string;
  mail?: string;
  phone?: string;
  name?: { first?: string; last?: string };
  gender?: string;
  dob?: string;
  timezone?: string;
  address?: { country?: string; state?: string; city?: string }[];
  isVerified?: { email?: string; phone?: string };
  qualityScore?: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const s = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const ver = (v: unknown) => (v === 'verified' || v === 'rejected' ? v : 'unverified');

export function mapQuestion(panel: PanelCode, q: RawQuestion): SourceQuestion {
  const max = q.maxSelections === undefined ? null : Number.parseInt(String(q.maxSelections), 10);
  return {
    panel,
    sourceQuestionId: q.name,
    label: q.label ?? q.name,
    type: s(q.type),
    parent: s(q.parent),
    categories: ([] as string[]).concat(q.category ?? []).map(String),
    isRequired: q.isRequired ?? null,
    hasOthers: q.hasOthers ?? null,
    hasNone: q.hasNone ?? null,
    maxSelections: max === null || Number.isNaN(max) ? null : max,
    sourceUpdatedAt: iso(q.updatedAt),
  };
}

export function mapOption(panel: PanelCode, o: RawOption): SourceOption {
  return {
    panel,
    sourceQuestionId: o.question,
    value: String(o.value ?? o.label ?? ''),
    label: String(o.label ?? o.value ?? ''),
    parentValues: (o.parentValue ?? []).map(String),
    isExclusive: Boolean(o.isExclusive),
  };
}

export function mapQuestionnaire(panel: PanelCode, p: RawProfile): SourceQuestionnaire {
  return {
    panel,
    slug: p.slug ?? p.name.toLowerCase().replace(/\s+/g, '-'),
    name: p.name,
    sourceCategory: p.category,
    pages: (p.pages ?? []).map((pg) => pg.map(String)),
    points: typeof p.points === 'number' ? p.points : null,
  };
}

export function mapUser(panel: PanelCode, u: RawUser): SourceRespondent {
  const addr = u.address?.[0] ?? {};
  return {
    panel,
    sourceMemberId: String(u._id),
    sourceRespondentRef: s(u.respondentID),
    sourceCategory: u.category ?? 'unknown',
    email: s(u.mail),
    phone: s(u.phone),
    firstName: s(u.name?.first),
    lastName: s(u.name?.last),
    gender: s(u.gender),
    dateOfBirth: u.dob ? (iso(u.dob)?.slice(0, 10) ?? null) : null,
    country: s(addr.country)?.toLowerCase() ?? null,
    state: s(addr.state),
    city: s(addr.city),
    timezone: s(u.timezone),
    emailVerification: ver(u.isVerified?.email),
    phoneVerification: ver(u.isVerified?.phone),
    qualityScore: typeof u.qualityScore === 'number' ? u.qualityScore : null,
    isActive: u.isActive !== false,
    sourceCreatedAt: iso(u.createdAt),
    sourceUpdatedAt: iso(u.updatedAt),
  };
}

/** profile-data / :id/profile responses are flat `{questionName: answer | answer[]}` maps merged with user fields. */
export function mapAnswerMap(
  panel: PanelCode,
  memberId: string,
  data: Record<string, unknown>,
  questionIds: Set<string>,
): SourceAnswer[] {
  return Object.entries(data)
    .filter(([k]) => questionIds.has(k))
    .map(([k, v]) => ({
      panel,
      sourceMemberId: memberId,
      sourceQuestionId: k,
      values: ([] as unknown[]).concat(v ?? []).map(String),
      sourceUpdatedAt: null,
    }));
}
