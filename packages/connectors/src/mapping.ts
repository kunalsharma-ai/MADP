import type {
  PanelCode,
  SourceOption,
  SourceQuestion,
  SourceQuestionnaire,
  SourceRespondent,
  SourceAnswer,
  SourceConsent,
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
  consent?: { canShareVideo?: boolean; canShareGPS?: boolean; canAcceptPushNotification?: boolean };
  terms?: string[];
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
  if (p && (isTeen || p.consentStatus || p.consent !== undefined)) {
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
