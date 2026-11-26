import { z } from 'zod';
import { AudienceCategory, PanelCode } from './panels.js';
import type { CampaignKind } from './engagement.js';

/**
 * Lifecycle automations and the celebration calendar (Milestone 4, part 2). An automation is a versioned rule:
 * trigger -> segment -> conditions -> contact gate (consent, quiet hours, fatigue) -> approved template per step ->
 * e-mail -> schedule -> stop condition. Versions are reviewed by a second person. Runs are dry runs.
 */
export const AutomationTrigger = z.enum(['inactivity', 'incomplete_profile', 'registration', 'birthday', 'festival']);
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;

/** The template kind each trigger's steps must use. */
export const TRIGGER_KINDS: Record<AutomationTrigger, CampaignKind[]> = {
  inactivity: ['reengagement'],
  incomplete_profile: ['profile_recovery'],
  // survey_reminder: the welcome journey's day-7 nudge to take a first survey.
  registration: ['welcome', 'profile_recovery', 'survey_reminder'],
  birthday: ['birthday'],
  festival: ['festival'],
};

/**
 * What counts as activity for inactivity: joining the panel, a profile answer the panel reports as changed, a survey
 * response (started or finished, from the panel's responses feed), or a real (not dry-run) open or click on a
 * message. The panels do not export logins, so those cannot count until they do.
 */
export const QUALIFYING_ACTIVITY = ['joined', 'profile_answer_updated', 'survey_response', 'message_opened_or_clicked'] as const;

export const AutomationStep = z.object({
  /**
   * Days after the trigger's reference date: days inactive (inactivity), days since joining (registration and
   * incomplete_profile). Birthday and festival automations have one step at day 0.
   */
  atDays: z.number().int().min(0).max(730),
  templateVersionId: z.string().uuid(),
  /** Registration only: send this step only while the profile is below the completion threshold. */
  onlyIfIncomplete: z.boolean().default(false),
});
export type AutomationStep = z.infer<typeof AutomationStep>;

export const AutomationConfig = z.object({
  audience: z
    .object({
      categories: z.array(AudienceCategory).max(5).optional(),
      countries: z.array(z.string().regex(/^[a-z]{2}$/)).max(50).optional(),
    })
    .default({}),
  /** incomplete_profile and registration: a profile below this share of the questions counts as incomplete. */
  completionThreshold: z.number().min(0.05).max(1).default(0.8),
  /** incomplete_profile: source question ids that must all be answered, in priority order. */
  requiredQuestionIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  /** Fewest days between two messages from this automation to one member. */
  minDaysBetween: z.number().int().min(1).max(365).default(7),
  /** festival: the approved calendar entry it greets. */
  celebrationId: z.string().uuid().optional(),
});
export type AutomationConfig = z.infer<typeof AutomationConfig>;

const versionBody = {
  config: AutomationConfig.prefault({}),
  steps: z.array(AutomationStep).min(1).max(8),
};
const stepsValid = (v: { steps: AutomationStep[] }) =>
  new Set(v.steps.map((s) => s.atDays)).size === v.steps.length;

export const AutomationCreate = z
  .object({
    panel: PanelCode,
    name: z.string().trim().min(2).max(120),
    trigger: AutomationTrigger,
    ...versionBody,
  })
  .refine(stepsValid, 'Each step needs a different day');
export type AutomationCreate = z.infer<typeof AutomationCreate>;

export const AutomationVersionCreate = z.object(versionBody).refine(stepsValid, 'Each step needs a different day');
export type AutomationVersionCreate = z.infer<typeof AutomationVersionCreate>;

export const AutomationReview = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional(),
});
export type AutomationReview = z.infer<typeof AutomationReview>;

export const AutomationDecision = z.object({ decision: z.enum(['pause', 'resume', 'archive']) });
export type AutomationDecision = z.infer<typeof AutomationDecision>;

export const AutomationRunRequest = z.object({
  dryRun: z.boolean().default(true),
  /** Evaluate as if it were this moment (for previewing a birthday or festival day). Defaults to now. */
  asOf: z.string().datetime().optional(),
});
export type AutomationRunRequest = z.infer<typeof AutomationRunRequest>;

/** Reasons an automation leaves a member out, on top of the campaign suppression reasons. */
export const AUTOMATION_REASONS = ['too_soon', 'no_birth_date', 'no_greeting_preference'] as const;

/**
 * `civic` greetings (a national day, the new year) go to members in the listed countries. `religious_cultural`
 * greetings go only to members who chose to receive that greeting: never to everyone in a country, because
 * religion is not inferred from geography. No panel records that choice yet.
 */
export const Observance = z.enum(['civic', 'religious_cultural']);
export type Observance = z.infer<typeof Observance>;

export const CelebrationCreate = z.object({
  panel: PanelCode,
  name: z.string().trim().min(2).max(120),
  observance: Observance,
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  countries: z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(50),
  note: z.string().trim().max(1000).optional(),
});
export type CelebrationCreate = z.infer<typeof CelebrationCreate>;

export const CelebrationReview = AutomationReview;
export type CelebrationReview = AutomationReview;

/**
 * The ready-made welcome journey for a new member: a welcome on day 1, a profile reminder on day 3 (only while the
 * profile is incomplete) and a first-survey nudge on day 7. It is an ordinary registration automation, so a second
 * admin approves it before it is active, and nothing is sent while sending is off.
 */
export const WELCOME_JOURNEY_NAME = 'Welcome journey';
export const WELCOME_JOURNEY_STEPS = [
  { atDays: 1, kind: 'welcome', onlyIfIncomplete: false, label: 'Welcome' },
  { atDays: 3, kind: 'profile_recovery', onlyIfIncomplete: true, label: 'Finish your profile' },
  { atDays: 7, kind: 'survey_reminder', onlyIfIncomplete: false, label: 'Take your first survey' },
] as const satisfies readonly { atDays: number; kind: CampaignKind; onlyIfIncomplete: boolean; label: string }[];

export const WelcomeJourneyStart = z.object({ panel: PanelCode }).strict();
export type WelcomeJourneyStart = z.infer<typeof WelcomeJourneyStart>;

export interface WelcomeJourneyPanel {
  panel: string;
  /** The journey's automation, once set up. */
  automation: { id: string; status: string; versionStatus: string | null } | null;
  /** Per step: the newest approved template of its kind on this panel, or null when one must be approved first. */
  steps: { atDays: number; kind: string; label: string; template: { versionId: string; name: string } | null }[];
}
