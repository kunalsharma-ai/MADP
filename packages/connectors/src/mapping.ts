import type {
  SourceResponse,
  SourceReward,
  PanelCode,
  SourceOption,
  SourceQuestion,
  SourceQuestionnaire,
  SourceRespondent,
  SourceAnswer,
  SourceConsent,
  SourceDeletion,
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
  /** Only the changes feed returns it (T2O GET /api/v1/changes/members). */
  isDeleted?: boolean;
  /** Admin or integration account (GET /api/v1/user and the changes feed, turn2opinion#21). */
  isStaff?: boolean;
  createdAt?: string;
  updatedAt?: string;
  consent?: { canShareVideo?: boolean; canShareGPS?: boolean; canAcceptPushNotification?: boolean };
  terms?: string[];
  /**
   * Marketing e-mail opt-in, the "Send me news and offers" box (shared backend, MFR#54). Unset means never asked.
   * The raw record has `wording`; the admin member view (/api/v1/admin/members) has `asked` instead.
   */
  marketingOptIn?: {
    granted?: boolean | null;
    at?: string | null;
    source?: string | null;
    wording?: string | null;
    asked?: boolean;
  } | null;
  parent?: {
    consent?: boolean | null;
    consentStatus?: string;
    consentAt?: string;
    consentVersion?: string;
    decision?: string;
    decisionAt?: string;
  };
}

/**
 * Guardian consent for teen members (T2O backend User.parent). Only the status is read: the guardian's name,
 * e-mail, phone, IP address and onboarding answers are never copied into MADP.
 */
const GUARDIAN_STATUS: Record<string, SourceConsent['status']> = {
  approved: 'granted',
  declined: 'denied',
  withdrawn: 'withdrawn',
  pending: 'unknown',
  expired: 'unknown',
  cancelled: 'unknown',
};

export function mapConsents(u: RawUser): SourceConsent[] {
  const out: SourceConsent[] = [];
  const p = u.parent;
  const isTeen = (u.category ?? '').includes('minor');
  // The backend returns a `parent` object with defaults (consent: null, empty lists) for every member, so only a
  // teen, a recorded status or an explicit yes/no counts as a guardian consent record.
  if (p && (isTeen || p.consentStatus || typeof p.consent === 'boolean' || p.decision)) {
    // Same order as the T2O User.registrationStatus virtual, so MADP agrees with what the member area shows.
    const status: SourceConsent['status'] =
      p.consent === true || p.consentStatus === 'approved'
        ? 'granted'
        : p.consentStatus
          ? (GUARDIAN_STATUS[p.consentStatus] ?? 'unknown')
          : p.consent === false || p.decision === 'no'
            ? 'denied'
            : 'unknown';
    out.push({
      purpose: 'guardian_consent',
      status,
      capturedAt: iso(p.consentAt ?? p.decisionAt),
      evidence: {
        field: p.consentStatus ? 'parent.consentStatus' : 'parent.consent',
        value: p.consentStatus ?? (p.consent === undefined || p.consent === null ? null : String(p.consent)),
        version: s(p.consentVersion),
      },
    });
  } else if (isTeen) {
    out.push({
      purpose: 'guardian_consent',
      status: 'unknown',
      capturedAt: null,
      evidence: { field: 'parent', value: null, version: null },
    });
  }
  if (u.terms?.length)
    out.push({
      purpose: 'terms',
      status: 'granted',
      capturedAt: null,
      evidence: { field: 'terms', value: null, version: u.terms.map(String).join(',').slice(0, 200) },
    });
  const flags: [keyof NonNullable<RawUser['consent']>, SourceConsent['purpose']][] = [
    ['canAcceptPushNotification', 'push_notifications'],
    ['canShareVideo', 'video_sharing'],
    ['canShareGPS', 'gps_sharing'],
  ];
  // Only the explicit opt-in counts as email_marketing (Kunal, 2026-11-24). Never the MFR "news-letter" profile
  // answer, and never a `marketing` id in User.terms on its own. Unset or never asked means no record: MADP's
  // consent view then reports it as missing, which already blocks marketing sends.
  const m = u.marketingOptIn;
  if (m && typeof m.granted === 'boolean' && m.asked !== false)
    out.push({
      purpose: 'email_marketing',
      // An unticked box at sign-up is a "no"; turning it off later is a withdrawal.
      status: m.granted ? 'granted' : m.source === 'signup' ? 'denied' : 'withdrawn',
      capturedAt: iso(m.at),
      evidence: {
        field: 'marketingOptIn.granted',
        value: String(m.granted),
        version: [s(m.wording), s(m.source)].filter(Boolean).join('@') || null,
      },
    });
  for (const [field, purpose] of flags) {
    const v = u.consent?.[field];
    if (typeof v === 'boolean')
      out.push({
        purpose,
        status: v ? 'granted' : 'denied',
        capturedAt: null,
        evidence: { field: `consent.${field}`, value: String(v), version: null },
      });
  }
  return out;
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
    // Page entries are [title, ...questionNames]; blank slots (seen in the T2O bank) name no question.
    pages: (p.pages ?? []).map((pg) => pg.map(String).filter((n, i) => i === 0 || n.trim() !== '')),
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
    isActive: u.isActive !== false && u.isDeleted !== true,
    ...(u.isDeleted === undefined ? {} : { isDeleted: u.isDeleted === true }),
    ...(u.isStaff ? { isStaff: true } : {}),
    sourceCreatedAt: iso(u.createdAt),
    sourceUpdatedAt: iso(u.updatedAt),
    consents: mapConsents(u),
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

/** Changes feed shapes (T2O GET /api/v1/changes/answers and /deletions). */
export interface RawAnswerChange {
  _id: string;
  user: string;
  question: string;
  answer?: unknown;
  updatedAt?: string;
}
export interface RawTombstone {
  _id: string;
  kind: string;
  user: string;
  at?: string;
}

export function mapAnswerChange(panel: PanelCode, a: RawAnswerChange): SourceAnswer {
  return {
    panel,
    sourceMemberId: String(a.user),
    sourceQuestionId: String(a.question),
    values: ([] as unknown[]).concat(a.answer ?? []).map(String),
    sourceUpdatedAt: iso(a.updatedAt),
  };
}

export function mapTombstone(panel: PanelCode, t: RawTombstone): SourceDeletion | null {
  if (t.kind !== 'member' && t.kind !== 'answers') return null;
  return { panel, sourceMemberId: String(t.user), kind: t.kind, at: iso(t.at) };
}

/** `GET /api/v1/changes/rewards` item (turn2opinion#24). */
export interface RawReward {
  _id: string;
  user: string;
  category?: string;
  points?: unknown;
  title?: string | null;
  status?: string;
  profile?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
/** `GET /api/v1/changes/responses` item (turn2opinion#24). */
export interface RawResponse {
  _id: string;
  user: string;
  survey?: string | null;
  status?: string;
  points?: unknown;
  loi?: unknown;
  source?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  isDeleted?: boolean;
  updatedAt?: string;
}

const int = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
};

export function mapReward(panel: PanelCode, r: RawReward): SourceReward | null {
  if (!r?._id || !r.user) return null;
  return {
    panel,
    sourceRewardId: String(r._id),
    sourceMemberId: String(r.user),
    category: s(r.category) ?? 'unknown',
    points: int(r.points),
    title: s(r.title),
    status: (s(r.status) ?? 'credited').toLowerCase(),
    profileSlug: s(r.profile),
    sourceCreatedAt: iso(r.createdAt),
    sourceUpdatedAt: iso(r.updatedAt),
  };
}

export function mapResponse(panel: PanelCode, r: RawResponse): SourceResponse | null {
  if (!r?._id || !r.user) return null;
  return {
    panel,
    sourceResponseId: String(r._id),
    sourceMemberId: String(r.user),
    surveySlug: s(r.survey),
    status: (s(r.status) ?? 'invited').toLowerCase(),
    points: int(r.points),
    loi: Number(r.loi) || 0,
    source: s(r.source),
    startedAt: iso(r.startedAt),
    endedAt: iso(r.endedAt),
    isDeleted: r.isDeleted === true,
    sourceUpdatedAt: iso(r.updatedAt),
  };
}
