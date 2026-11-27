/**
 * Capabilities a panel can declare in its discovery answer. MADP calls only the routes of declared capabilities and
 * shows "this panel does not offer that" for the rest, so a small panel can join with the core set and grow later.
 *
 * `core` capabilities are required for a panel to be connected at all. Everything else is optional.
 * `personal` marks capabilities whose read routes return personal data: the conformance kit probes them only when the
 * owner has approved live access to that panel.
 */
export interface CapabilityInfo {
  title: string;
  /** One plain sentence on what MADP does with it. */
  purpose: string;
  surface: 'sync' | 'admin' | 'push';
  core?: true;
  personal?: true;
}

export const CAPABILITIES = {
  // ---- read and sync (bearer token) ------------------------------------------------------------------------------
  'contract.discovery': {
    title: 'Contract discovery',
    purpose: 'Tells MADP which contract version the panel speaks and which capabilities it offers.',
    surface: 'sync',
    core: true,
  },
  'questions.read': {
    title: 'Question list',
    purpose: 'The profile questions, so MADP can map them to its attribute registry.',
    surface: 'sync',
    core: true,
  },
  'options.read': {
    title: 'Answer options',
    purpose: 'The options of each question, for value mapping.',
    surface: 'sync',
    core: true,
  },
  'questionnaires.read': {
    title: 'Profile questionnaires',
    purpose: 'Which questions belong to which profile, page by page.',
    surface: 'sync',
    core: true,
  },
  'members.read': {
    title: 'Member list (full import)',
    purpose: 'A full member import. Optional when the changes feeds are served.',
    surface: 'sync',
    personal: true,
  },
  'answers.read': {
    title: 'One member’s answers',
    purpose: 'A full answer import for named members.',
    surface: 'sync',
    personal: true,
  },
  'changes.members': {
    title: 'Member changes feed',
    purpose: 'Automatic sync: members changed since the last run.',
    surface: 'sync',
    core: true,
    personal: true,
  },
  'changes.answers': {
    title: 'Answer changes feed',
    purpose: 'Automatic sync: answers changed since the last run.',
    surface: 'sync',
    core: true,
    personal: true,
  },
  'changes.deletions': {
    title: 'Deletions feed',
    purpose: 'Deleted members and reset answers, so MADP deletes them too.',
    surface: 'sync',
    core: true,
    personal: true,
  },
  'changes.rewards': {
    title: 'Reward changes feed',
    purpose: 'Points rows for MADP’s read-only loyalty mirror.',
    surface: 'sync',
    personal: true,
  },
  'changes.responses': {
    title: 'Survey response changes feed',
    purpose: 'Survey outcomes for the loyalty mirror and survey reports.',
    surface: 'sync',
    personal: true,
  },
  special_category: {
    title: 'Special-category answers',
    purpose:
      'Declares that some answers are special-category (health) data. MADP then applies purpose checks, guardian consent for minors and larger cell sizes.',
    surface: 'sync',
  },
  // ---- push (panel to MADP) ---------------------------------------------------------------------------------------
  'webhooks.push': {
    title: 'Change webhooks',
    purpose: 'The panel tells MADP that something changed, so sync runs at once instead of on the schedule.',
    surface: 'push',
  },
  // ---- signed admin API -------------------------------------------------------------------------------------------
  'admin.members': {
    title: 'Member admin',
    purpose: 'Search, view and edit members, status, segment, ledger and unmasking with a reason.',
    surface: 'admin',
    personal: true,
  },
  'admin.members.actions': {
    title: 'Member actions',
    purpose: 'Password reset and welcome e-mails, and “log in as member” with session tracking.',
    surface: 'admin',
    personal: true,
  },
  'admin.members.engagement': {
    title: 'Member engagement view',
    purpose: 'What the member sees, survey history, alert channels and payout method.',
    surface: 'admin',
    personal: true,
  },
  'admin.members.duplicates': {
    title: 'Duplicate accounts',
    purpose: 'Find, merge (dry run first) and undo merges of duplicate accounts.',
    surface: 'admin',
    personal: true,
  },
  'admin.members.archive': {
    title: 'Six-month check and archive',
    purpose: 'Archive inactive members and restore them.',
    surface: 'admin',
    personal: true,
  },
  'admin.question_bank': {
    title: 'Question bank',
    purpose: 'Questions, options, translations, rules, Excel import and export, and versions with review.',
    surface: 'admin',
  },
  'admin.profiles': {
    title: 'Profiles',
    purpose: 'Profile questionnaires and completion rates.',
    surface: 'admin',
  },
  'admin.about_you': {
    title: 'About You lock',
    purpose:
      'Which profiles a member must finish before surveys and the other profiles open, per brand and segment (contract 1.1).',
    surface: 'admin',
  },
  'admin.segments': {
    title: 'Segments',
    purpose: 'Panel segments such as consumer, B2B, teens, HCP.',
    surface: 'admin',
  },
  'admin.audiences': {
    title: 'Audiences',
    purpose: 'Saved audiences and their counts.',
    surface: 'admin',
  },
  'admin.surveys': {
    title: 'Surveys',
    purpose: 'Surveys, feasibility, invitations, responses and reconciliation.',
    surface: 'admin',
    personal: true,
  },
  'admin.points': {
    title: 'Points',
    purpose: 'Point adjustments with four-eyes approval, and holds.',
    surface: 'admin',
    personal: true,
  },
  'admin.quality': {
    title: 'Quality and referral checks',
    purpose: 'Quality tiers, review queue, per-member quality and referral fraud.',
    surface: 'admin',
    personal: true,
  },
  'admin.experts': {
    title: 'Expert verification',
    purpose: 'Review B2B and HCP verification requests.',
    surface: 'admin',
    personal: true,
  },
  'admin.tickets': {
    title: 'Support tickets',
    purpose: 'Ticket desk with replies and notes.',
    surface: 'admin',
    personal: true,
  },
  'admin.messages': {
    title: 'Portal messages',
    purpose: 'Messages shown in the member portal.',
    surface: 'admin',
  },
  'admin.help': { title: 'Help centre', purpose: 'Help articles per brand.', surface: 'admin' },
  'admin.content': {
    title: 'Content and legal pages',
    purpose: 'Pages with drafts, second-person review, revisions and restore.',
    surface: 'admin',
  },
  'admin.switches': {
    title: 'Feature switches',
    purpose: 'Feature on/off per brand, segment and country.',
    surface: 'admin',
  },
  'admin.reminders': {
    title: 'Auto reminders and channels',
    purpose: 'Rule-based reminders and the WhatsApp and SMS provider settings.',
    surface: 'admin',
  },
  'admin.prize_machines': {
    title: 'Prize machines',
    purpose: 'One prize machine per segment.',
    surface: 'admin',
  },
  'admin.reports': {
    title: 'Reports',
    purpose: 'Aggregate counts per brand. No personal data.',
    surface: 'admin',
  },
  'admin.rewards': {
    title: 'Rewards and redemptions',
    purpose: 'Reward catalogue and the redemption queue.',
    surface: 'admin',
    personal: true,
  },
  'admin.draws': { title: 'Lucky draws', purpose: 'Draws, run and cancel.', surface: 'admin' },
  'admin.offers': { title: 'Offers', purpose: 'Bonus offers and ending them.', surface: 'admin' },
  'admin.engagement': {
    title: 'Engagement studio',
    purpose: 'Tasks, ideas, stories and streaks.',
    surface: 'admin',
  },
  'admin.teens': {
    title: 'Teens and guardians',
    purpose: 'Teen registrations, guardian links, turning 18.',
    surface: 'admin',
    personal: true,
  },
  'admin.data_requests': {
    title: 'Data requests',
    purpose: 'Member access and deletion requests.',
    surface: 'admin',
    personal: true,
  },
} as const satisfies Record<string, CapabilityInfo>;

export type Capability = keyof typeof CAPABILITIES;
export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as Capability[];
export const CORE_CAPABILITIES = CAPABILITY_IDS.filter((c) => (CAPABILITIES[c] as CapabilityInfo).core);

export function isCapability(c: string): c is Capability {
  return Object.hasOwn(CAPABILITIES, c);
}

/**
 * What the shared panel backend (the one image that serves T2O, MFR and MHO today) offers. Used for a panel that has
 * not answered discovery yet, so the three existing panels keep working while the backend adds the discovery route.
 * `special_category` is added per panel (MHO), never assumed.
 */
export const SHARED_BACKEND_CAPABILITIES: Capability[] = CAPABILITY_IDS.filter(
  (c) => c !== 'special_category' && c !== 'webhooks.push',
);
