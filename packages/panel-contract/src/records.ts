import { z } from 'zod';

/**
 * Record shapes of the read and sync routes. These are the T2O backend's own documents (Question, Option, Profile,
 * User, Answer, Tombstone, Rewards, Response) with the fields MADP reads. Panels may send more fields: unknown fields
 * are kept and ignored, so adding a field is never a breaking change.
 *
 * Personal data rules that are part of the contract:
 * - No free-text reward remarks and no response telemetry in the feeds.
 * - A record of a staff or integration account carries `isStaff: true`, so MADP leaves it out of audience counts.
 * - Health answers (MHO, or any panel that declares `special_category`) are special-category data. MADP never infers a
 *   health fact from membership of a panel, and the panel never sends a health answer outside the answers feed.
 */

/** T2O response envelope. Every route answers with it, success or error. */
export const Envelope = <T extends z.ZodType>(data: T) =>
  z.looseObject({
    status: z.literal('success'),
    message: z.string().optional(),
    data,
  });

export const ErrorEnvelope = z.looseObject({
  status: z.literal('error'),
  message: z.string(),
  /** Stable machine code, e.g. `not_found`, `reason_required`, `bad_signature`. */
  code: z.string().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

const idLike = z.union([z.string(), z.number()]).transform(String);
const date = z.string().nullish();

export const QuestionRecord = z.looseObject({
  _id: idLike.optional(),
  /** The question key. Unique per panel; options and answers refer to it. */
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.string().optional(),
  parent: z.string().nullish(),
  category: z.union([z.array(z.string()), z.string()]).optional(),
  isRequired: z.boolean().optional(),
  hasOthers: z.boolean().optional(),
  hasNone: z.boolean().optional(),
  maxSelections: z.union([z.string(), z.number()]).optional(),
  updatedAt: date,
});

export const OptionRecord = z.looseObject({
  question: z.string(),
  label: z.string().optional(),
  value: z.string().optional(),
  parentValue: z.array(z.string()).optional(),
  isExclusive: z.boolean().optional(),
});

/** A profile questionnaire. `pages` lists question names, page by page. */
export const ProfileRecord = z.looseObject({
  slug: z.string().optional(),
  name: z.string(),
  category: z.string(),
  pages: z.array(z.array(z.string())).optional(),
  points: z.number().optional(),
});

export const MemberRecord = z.looseObject({
  _id: idLike,
  respondentID: z.string().optional(),
  /** Member type, e.g. `b2c`, `b2b`, `b2c-minor`, `hcp`, `patient`, `caregiver`. */
  category: z.string().optional(),
  mail: z.string().optional(),
  phone: z.string().optional(),
  name: z.looseObject({ first: z.string().optional(), last: z.string().optional() }).optional(),
  gender: z.string().optional(),
  dob: date,
  timezone: z.string().optional(),
  address: z
    .array(
      z.looseObject({
        country: z.string().optional(),
        state: z.string().optional(),
        city: z.string().optional(),
      }),
    )
    .optional(),
  isVerified: z.looseObject({ email: z.string().optional(), phone: z.string().optional() }).optional(),
  qualityScore: z.number().optional(),
  isActive: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  isStaff: z.boolean().optional(),
  createdAt: date,
  updatedAt: date,
  consent: z
    .looseObject({
      canShareVideo: z.boolean().optional(),
      canShareGPS: z.boolean().optional(),
      canAcceptPushNotification: z.boolean().optional(),
    })
    .optional(),
  /** Accepted terms ids. `marketing` means the member opted in to news and offers. */
  terms: z.array(z.string()).optional(),
});
export type MemberRecord = z.infer<typeof MemberRecord>;

export const AnswerRecord = z.looseObject({
  _id: idLike,
  user: idLike,
  question: z.string(),
  answer: z.unknown().optional(),
  updatedAt: date,
});

/** Written when a member or their answers are deleted, so MADP deletes them too. */
export const TombstoneRecord = z.looseObject({
  _id: idLike,
  kind: z.string(),
  user: idLike,
  at: date,
});

export const RewardRecord = z.looseObject({
  _id: idLike,
  user: idLike,
  category: z.string().optional(),
  points: z.unknown().optional(),
  title: z.string().nullish(),
  status: z.string().optional(),
  profile: z.string().nullish(),
  createdAt: date,
  updatedAt: date,
});

export const ResponseRecord = z.looseObject({
  _id: idLike,
  user: idLike,
  survey: z.string().nullish(),
  status: z.string().optional(),
  points: z.unknown().optional(),
  loi: z.unknown().optional(),
  source: z.string().nullish(),
  startedAt: date,
  endedAt: date,
  isDeleted: z.boolean().optional(),
  updatedAt: date,
});

/**
 * One page of a changes feed (`GET /api/v1/changes/*?cursor=&since=&limit=`).
 * Order is (updatedAt, _id) ascending, and the newest 5 seconds are held back so a page never misses a late write.
 * `cursor` is opaque to MADP: it sends it back unchanged. `more: false` means the feed is caught up.
 */
export const ChangePage = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    items: z.array(item),
    cursor: z.string().nullish(),
    more: z.boolean().optional(),
  });

/** `GET /api/v1/user/:id/profile`: the member's answers keyed by question name. */
export const MemberAnswerMap = z.record(z.string(), z.unknown());

/** Signed admin lists answer with a plain array or `{items, total?, next?}`. */
export const AdminList = z.union([
  z.array(z.unknown()),
  z.looseObject({ items: z.array(z.unknown()) }),
  z.record(z.string(), z.unknown()),
]);
