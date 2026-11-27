import type { Capability } from './capabilities.js';

/**
 * Every route of the contract. This table is the single source of panel routes: MADP's connectors build their paths
 * from it, the OpenAPI document is generated from it, and the conformance kit probes from it.
 *
 * Paths use `{param}` placeholders and are relative to the panel's base URL. They are the T2O backend's routes.
 */
export type Method = 'GET' | 'POST' | 'PUT';
export type Auth = 'bearer' | 'signed' | 'either';

export interface Operation {
  /** Stable id: `<resource>.<method>` for read and sync routes, `admin.<resource>.<method>` for admin ones. Used as the OpenAPI operationId. */
  id: string;
  resource: string;
  method: Method;
  path: string;
  capability: Capability;
  auth: Auth;
  summary: string;
  /** Changes data on the panel. The conformance kit never calls these. */
  writes: boolean;
  /** Query parameters the route understands (all optional). */
  query?: readonly string[];
  /** Allowed values of path parameters that are a fixed list (e.g. `{action}`). */
  enums?: Readonly<Record<string, readonly string[]>>;
  /** For the conformance kit: the record schema of the answer, by name in records.ts. */
  answer?:
    'questions' | 'options' | 'profiles' | 'members' | 'answerMap' | 'changes' | 'discovery' | 'adminList';
}

interface ResourceSpec {
  path: string;
  capability: Capability;
  auth?: Auth;
  methods: Partial<Record<Method, string>>;
  query?: readonly string[];
  enums?: Readonly<Record<string, readonly string[]>>;
  answer?: Operation['answer'];
}

const CHANGES_QUERY = ['cursor', 'since', 'limit'] as const;

/** Read and sync routes (bearer token), the T2O backend's public API. */
const SYNC: Record<string, ResourceSpec> = {
  contract: {
    path: '/api/v1/contract',
    capability: 'contract.discovery',
    auth: 'either',
    methods: { GET: 'Contract version, brands and capabilities of this panel' },
    answer: 'discovery',
  },
  question: {
    path: '/api/v1/question',
    capability: 'questions.read',
    methods: { GET: 'All profile questions' },
    answer: 'questions',
  },
  option: {
    path: '/api/v1/option/{question}',
    capability: 'options.read',
    methods: { GET: 'Options of one question' },
    answer: 'options',
  },
  profile: {
    path: '/api/v1/profile',
    capability: 'questionnaires.read',
    methods: { GET: 'Profile questionnaires with their pages of question names' },
    answer: 'profiles',
  },
  user: {
    path: '/api/v1/user',
    capability: 'members.read',
    methods: { GET: 'All members (admin token only). Full import' },
    answer: 'members',
  },
  changesMembers: {
    path: '/api/v1/changes/members',
    capability: 'changes.members',
    methods: { GET: 'Members changed since a cursor, including deactivated and soft-deleted' },
    query: CHANGES_QUERY,
    answer: 'changes',
  },
  changesAnswers: {
    path: '/api/v1/changes/answers',
    capability: 'changes.answers',
    methods: { GET: 'Answers changed since a cursor' },
    query: CHANGES_QUERY,
    answer: 'changes',
  },
  changesDeletions: {
    path: '/api/v1/changes/deletions',
    capability: 'changes.deletions',
    methods: { GET: 'Tombstones of deleted members and reset answers' },
    query: CHANGES_QUERY,
    answer: 'changes',
  },
  changesRewards: {
    path: '/api/v1/changes/rewards',
    capability: 'changes.rewards',
    methods: { GET: 'Reward rows changed since a cursor (no free-text remarks)' },
    query: CHANGES_QUERY,
    answer: 'changes',
  },
  changesResponses: {
    path: '/api/v1/changes/responses',
    capability: 'changes.responses',
    methods: { GET: 'Survey responses changed since a cursor (no telemetry)' },
    query: CHANGES_QUERY,
    answer: 'changes',
  },
  userProfile: {
    path: '/api/v1/user/{id}/profile',
    capability: 'answers.read',
    methods: { GET: 'One member’s answers keyed by question name' },
    answer: 'answerMap',
  },
};

const A = '/api/v1/admin';
const LIST = ['limit', 'skip', 'q', 'status'] as const;
const VERSION_ACTIONS = { action: ['review', 'publish', 'discard'] } as const;

/** Signed admin routes (the shared backend's `/api/v1/admin`). The brand is the signed `x-madp-origin` header. */
const ADMIN: Record<string, ResourceSpec> = {
  // members
  members: {
    path: `${A}/members`,
    capability: 'admin.members',
    methods: { GET: 'Search members' },
    query: [
      'q',
      'status',
      'segment',
      'country',
      'gender',
      'type',
      'bornFrom',
      'bornTo',
      'sort',
      'order',
      'limit',
      'skip',
    ],
    answer: 'adminList',
  },
  member: {
    path: `${A}/members/{id}`,
    capability: 'admin.members',
    methods: { GET: 'One member (masked)', PUT: 'Change member fields' },
  },
  memberLedger: {
    path: `${A}/members/{id}/ledger`,
    capability: 'admin.members',
    methods: { GET: 'Points ledger of a member' },
  },
  memberStatus: {
    path: `${A}/members/{id}/status`,
    capability: 'admin.members',
    methods: { POST: 'Set member status with a reason' },
  },
  memberSegment: {
    path: `${A}/members/{id}/segment`,
    capability: 'admin.members',
    methods: { POST: 'Move a member to another segment' },
  },
  memberUnmask: {
    path: `${A}/members/{id}/unmask`,
    capability: 'admin.members',
    methods: { POST: 'Unmask contact details with a reason' },
  },
  memberResetPassword: {
    path: `${A}/members/{id}/reset-password`,
    capability: 'admin.members.actions',
    methods: { POST: 'Send a password reset e-mail' },
  },
  memberResendWelcome: {
    path: `${A}/members/{id}/resend-welcome`,
    capability: 'admin.members.actions',
    methods: { POST: 'Send the welcome e-mail again' },
  },
  memberLoginAs: {
    path: `${A}/members/{id}/login-as`,
    capability: 'admin.members.actions',
    methods: { POST: 'Start a “log in as member” session' },
  },
  memberAdminSessions: {
    path: `${A}/members/{id}/admin-sessions`,
    capability: 'admin.members.actions',
    methods: { GET: 'Admin sessions on this member' },
  },
  memberAdminSessionEnd: {
    path: `${A}/members/{id}/admin-sessions/{sid}/end`,
    capability: 'admin.members.actions',
    methods: { POST: 'End an admin session' },
  },
  memberEngagement: {
    path: `${A}/members/{id}/engagement`,
    capability: 'admin.members.engagement',
    methods: { GET: 'What the member sees: streaks, alerts, payout method' },
  },
  memberResponses: {
    path: `${A}/members/{id}/responses`,
    capability: 'admin.members.engagement',
    methods: { GET: 'Survey participation of a member' },
    query: LIST,
  },
  memberAlerts: {
    path: `${A}/members/{id}/alerts`,
    capability: 'admin.members.engagement',
    methods: { PUT: 'Alert channels of a member' },
  },
  memberPayoutClear: {
    path: `${A}/members/{id}/payout/clear`,
    capability: 'admin.members.engagement',
    methods: { POST: 'Clear the saved payout method' },
  },
  duplicates: {
    path: `${A}/members/duplicates`,
    capability: 'admin.members.duplicates',
    methods: { GET: 'Likely duplicate accounts' },
    query: LIST,
    answer: 'adminList',
  },
  merge: {
    path: `${A}/members/merge`,
    capability: 'admin.members.duplicates',
    methods: { POST: 'Merge accounts (dry run unless dryRun=0)' },
    query: ['dryRun'],
  },
  merges: {
    path: `${A}/members/merges`,
    capability: 'admin.members.duplicates',
    methods: { GET: 'Past merges' },
    query: LIST,
    answer: 'adminList',
  },
  mergeUndo: {
    path: `${A}/members/merges/{id}/undo`,
    capability: 'admin.members.duplicates',
    methods: { POST: 'Undo a merge' },
  },
  archiveRun: {
    path: `${A}/members/archive-run`,
    capability: 'admin.members.archive',
    methods: { POST: 'Six-month check: archive inactive members (dry run first)' },
  },
  restore: {
    path: `${A}/members/restore`,
    capability: 'admin.members.archive',
    methods: { POST: 'Restore archived members' },
  },
  memberPoints: {
    path: `${A}/members/{id}/points`,
    capability: 'admin.points',
    methods: { POST: 'Add or remove points (four eyes above the limit)' },
  },
  memberQuality: {
    path: `${A}/members/{id}/quality`,
    capability: 'admin.quality',
    methods: { GET: 'Quality history of a member', POST: 'Set a quality decision' },
  },
  // question bank and profiles
  qbExport: {
    path: `${A}/qb/export`,
    capability: 'admin.question_bank',
    methods: { GET: 'Export the question bank' },
  },
  qbImport: {
    path: `${A}/qb/import`,
    capability: 'admin.question_bank',
    methods: { POST: 'Import questions (dry run first)' },
    query: ['dryRun'],
  },
  qbRulesCheck: {
    path: `${A}/qb/rules/check`,
    capability: 'admin.question_bank',
    methods: { GET: 'Check the skip and show rules' },
  },
  questions: {
    path: `${A}/questions`,
    capability: 'admin.question_bank',
    methods: { GET: 'Question bank list', POST: 'Add a question' },
    query: LIST,
    answer: 'adminList',
  },
  question: {
    path: `${A}/questions/{name}`,
    capability: 'admin.question_bank',
    methods: { GET: 'One question', PUT: 'Change a question' },
  },
  questionOptions: {
    path: `${A}/questions/{name}/options`,
    capability: 'admin.question_bank',
    methods: { PUT: 'Replace the options of a question' },
  },
  questionTranslations: {
    path: `${A}/questions/{name}/translations`,
    capability: 'admin.question_bank',
    methods: { PUT: 'Translations of a question' },
  },
  missingTranslations: {
    path: `${A}/qb/translations/missing`,
    capability: 'admin.question_bank',
    methods: { GET: 'Questions missing a translation' },
    query: ['language'],
  },
  qbVersions: {
    path: `${A}/qb/versions`,
    capability: 'admin.question_bank',
    methods: { GET: 'Question bank versions', POST: 'Start a new version' },
    answer: 'adminList',
  },
  qbVersion: {
    path: `${A}/qb/versions/{n}`,
    capability: 'admin.question_bank',
    methods: { GET: 'One version with its changes' },
  },
  qbVersionAction: {
    path: `${A}/qb/versions/{n}/{action}`,
    capability: 'admin.question_bank',
    methods: { POST: 'Review, publish or discard a version (second person)' },
    enums: VERSION_ACTIONS,
  },
  profiles: {
    path: `${A}/profiles`,
    capability: 'admin.profiles',
    methods: { GET: 'Profile questionnaires' },
    answer: 'adminList',
  },
  profileCompletion: {
    path: `${A}/profiles/completion`,
    capability: 'admin.profiles',
    methods: { GET: 'Completion per profile' },
  },
  profile: { path: `${A}/profiles/{id}`, capability: 'admin.profiles', methods: { PUT: 'Change a profile' } },
  // About You lock (contract 1.1): the panel refuses surveys and the other profiles until these are complete
  aboutYou: {
    path: `${A}/about-you`,
    capability: 'admin.about_you',
    methods: { GET: 'About You profiles per segment', PUT: 'Change the About You list with a reason' },
  },
  // segments and audiences
  segments: {
    path: `${A}/segments`,
    capability: 'admin.segments',
    methods: { GET: 'Segments of the brand' },
    answer: 'adminList',
  },
  segment: {
    path: `${A}/segments/{name}`,
    capability: 'admin.segments',
    methods: { PUT: 'Change a segment' },
  },
  audienceCount: {
    path: `${A}/audiences/count`,
    capability: 'admin.audiences',
    methods: { POST: 'Count members for a filter (no ids)' },
  },
  audiences: {
    path: `${A}/audiences`,
    capability: 'admin.audiences',
    methods: { GET: 'Saved audiences', POST: 'Save an audience' },
    answer: 'adminList',
  },
  audience: {
    path: `${A}/audiences/{id}`,
    capability: 'admin.audiences',
    methods: { PUT: 'Change an audience' },
  },
  audienceRecount: {
    path: `${A}/audiences/{id}/count`,
    capability: 'admin.audiences',
    methods: { POST: 'Count a saved audience again' },
  },
  // surveys
  surveys: {
    path: `${A}/surveys`,
    capability: 'admin.surveys',
    methods: { GET: 'Surveys', POST: 'Add a survey' },
    query: LIST,
    answer: 'adminList',
  },
  survey: {
    path: `${A}/surveys/{id}`,
    capability: 'admin.surveys',
    methods: { GET: 'One survey', PUT: 'Change a survey' },
  },
  surveyStatus: {
    path: `${A}/surveys/{id}/status`,
    capability: 'admin.surveys',
    methods: { POST: 'Open, pause or close a survey' },
  },
  surveyFeasibility: {
    path: `${A}/surveys/{id}/feasibility`,
    capability: 'admin.surveys',
    methods: { POST: 'How many members fit' },
  },
  surveyInvite: {
    path: `${A}/surveys/{id}/invite`,
    capability: 'admin.surveys',
    methods: { POST: 'Invite members (dry run first)' },
    query: ['dryRun'],
  },
  surveyResponses: {
    path: `${A}/surveys/{id}/responses`,
    capability: 'admin.surveys',
    methods: { GET: 'Responses of a survey' },
    query: LIST,
  },
  surveyReconcile: {
    path: `${A}/surveys/{id}/reconcile`,
    capability: 'admin.surveys',
    methods: { POST: 'Reconcile completes with the client list' },
  },
  // points and quality
  pointsApprovals: {
    path: `${A}/points/approvals`,
    capability: 'admin.points',
    methods: { GET: 'Point changes waiting for a second admin' },
    answer: 'adminList',
  },
  pointsApproval: {
    path: `${A}/points/approvals/{id}`,
    capability: 'admin.points',
    methods: { POST: 'Approve or reject a point change' },
  },
  holds: {
    path: `${A}/points/holds`,
    capability: 'admin.points',
    methods: { GET: 'Points on hold', POST: 'Put points on hold' },
    answer: 'adminList',
  },
  holdRelease: {
    path: `${A}/points/holds/{id}/release`,
    capability: 'admin.points',
    methods: { POST: 'Release a hold' },
  },
  qualityTiers: {
    path: `${A}/quality/tiers`,
    capability: 'admin.quality',
    methods: { GET: 'Members per quality tier' },
  },
  qualityReview: {
    path: `${A}/quality/review`,
    capability: 'admin.quality',
    methods: { GET: 'Members to review' },
    query: LIST,
    answer: 'adminList',
  },
  referralFraud: {
    path: `${A}/referrals/fraud`,
    capability: 'admin.quality',
    methods: { GET: 'Suspicious referral chains' },
    query: LIST,
    answer: 'adminList',
  },
  // experts
  experts: {
    path: `${A}/experts`,
    capability: 'admin.experts',
    methods: { GET: 'Expert verification requests' },
    query: LIST,
    answer: 'adminList',
  },
  expert: {
    path: `${A}/experts/{id}`,
    capability: 'admin.experts',
    methods: { GET: 'One request with its evidence' },
  },
  expertDecision: {
    path: `${A}/experts/{id}/decision`,
    capability: 'admin.experts',
    methods: { POST: 'Approve or decline with a reason' },
  },
  // support
  tickets: {
    path: `${A}/tickets`,
    capability: 'admin.tickets',
    methods: { GET: 'Ticket desk' },
    query: LIST,
    answer: 'adminList',
  },
  ticket: {
    path: `${A}/tickets/{id}`,
    capability: 'admin.tickets',
    methods: { GET: 'One ticket', PUT: 'Change a ticket' },
  },
  ticketReply: {
    path: `${A}/tickets/{id}/reply`,
    capability: 'admin.tickets',
    methods: { POST: 'Reply or add an internal note' },
  },
  ticketStatus: {
    path: `${A}/tickets/{id}/status`,
    capability: 'admin.tickets',
    methods: { POST: 'Change ticket status' },
  },
  messages: {
    path: `${A}/messages`,
    capability: 'admin.messages',
    methods: { GET: 'Portal messages', POST: 'Draft a message' },
    answer: 'adminList',
  },
  message: {
    path: `${A}/messages/{id}`,
    capability: 'admin.messages',
    methods: { GET: 'One message', PUT: 'Change a draft' },
  },
  messagePreview: {
    path: `${A}/messages/{id}/preview`,
    capability: 'admin.messages',
    methods: { POST: 'Count and preview before sending' },
  },
  messageSend: {
    path: `${A}/messages/{id}/send`,
    capability: 'admin.messages',
    methods: { POST: 'Send a message' },
  },
  messageWithdraw: {
    path: `${A}/messages/{id}/withdraw`,
    capability: 'admin.messages',
    methods: { POST: 'Withdraw a message' },
  },
  help: {
    path: `${A}/help`,
    capability: 'admin.help',
    methods: { GET: 'Help articles', POST: 'Add an article' },
    answer: 'adminList',
  },
  helpEntry: { path: `${A}/help/{id}`, capability: 'admin.help', methods: { PUT: 'Change an article' } },
  helpStatus: {
    path: `${A}/help/{id}/status`,
    capability: 'admin.help',
    methods: { POST: 'Publish or unpublish an article' },
  },
  // content
  content: {
    path: `${A}/content`,
    capability: 'admin.content',
    methods: { GET: 'Content and legal pages', POST: 'Add a page' },
    answer: 'adminList',
  },
  contentPage: {
    path: `${A}/content/{id}`,
    capability: 'admin.content',
    methods: { GET: 'One page', PUT: 'Save a draft' },
  },
  contentAction: {
    path: `${A}/content/{id}/{action}`,
    capability: 'admin.content',
    methods: { POST: 'Review, publish or discard a draft (second person)' },
    enums: VERSION_ACTIONS,
  },
  contentRevisions: {
    path: `${A}/content/{id}/revisions`,
    capability: 'admin.content',
    methods: { GET: 'Revisions of a page' },
  },
  contentRevision: {
    path: `${A}/content/{id}/revisions/{version}`,
    capability: 'admin.content',
    methods: { GET: 'One revision' },
  },
  contentRestore: {
    path: `${A}/content/{id}/revisions/{version}/restore`,
    capability: 'admin.content',
    methods: { POST: 'Restore a revision as a draft' },
  },
  // switches, reminders, channels
  switches: {
    path: `${A}/switches`,
    capability: 'admin.switches',
    methods: { GET: 'Feature switches with their rules' },
    answer: 'adminList',
  },
  switch: {
    path: `${A}/switches/{key}`,
    capability: 'admin.switches',
    methods: { PUT: 'Set a switch rule with a reason' },
  },
  reminders: {
    path: `${A}/reminders`,
    capability: 'admin.reminders',
    methods: { GET: 'Reminder rules', PUT: 'Change reminder rules' },
  },
  remindersPreview: {
    path: `${A}/reminders/preview`,
    capability: 'admin.reminders',
    methods: { POST: 'Who would get a reminder now (nothing sent)' },
  },
  channels: {
    path: `${A}/channels`,
    capability: 'admin.reminders',
    methods: { GET: 'WhatsApp and SMS providers (secrets never returned)' },
  },
  channel: {
    path: `${A}/channels/{channel}`,
    capability: 'admin.reminders',
    methods: { PUT: 'Set a provider' },
  },
  channelCheck: {
    path: `${A}/channels/{channel}/check`,
    capability: 'admin.reminders',
    methods: { POST: 'Check a provider' },
  },
  channelRemove: {
    path: `${A}/channels/{channel}/remove`,
    capability: 'admin.reminders',
    methods: { POST: 'Remove a provider' },
  },
  // prize machines, reports
  prizeMachines: {
    path: `${A}/prize-machines`,
    capability: 'admin.prize_machines',
    methods: { GET: 'Prize machines per segment' },
    answer: 'adminList',
  },
  prizeMachine: {
    path: `${A}/prize-machines/{segment}`,
    capability: 'admin.prize_machines',
    methods: { PUT: 'Set the machine of a segment' },
  },
  prizeMachinePlays: {
    path: `${A}/prize-machines/{segment}/plays`,
    capability: 'admin.prize_machines',
    methods: { GET: 'Plays of a machine' },
  },
  report: {
    path: `${A}/reports/{name}`,
    capability: 'admin.reports',
    methods: { GET: 'One aggregate report' },
    query: ['from', 'to', 'segment', 'country'],
  },
  // rewards
  catalogue: {
    path: `${A}/rewards/catalogue`,
    capability: 'admin.rewards',
    methods: { GET: 'Reward catalogue', POST: 'Add a reward' },
    answer: 'adminList',
  },
  catalogueItem: {
    path: `${A}/rewards/catalogue/{key}`,
    capability: 'admin.rewards',
    methods: { PUT: 'Change a reward' },
  },
  redemptions: {
    path: `${A}/redemptions`,
    capability: 'admin.rewards',
    methods: { GET: 'Redemption queue' },
    query: LIST,
    answer: 'adminList',
  },
  redemption: {
    path: `${A}/redemptions/{id}`,
    capability: 'admin.rewards',
    methods: { GET: 'One redemption' },
  },
  redemptionDecision: {
    path: `${A}/redemptions/{id}/decision`,
    capability: 'admin.rewards',
    methods: { POST: 'Approve or reject with a reason' },
  },
  draws: {
    path: `${A}/draws`,
    capability: 'admin.draws',
    methods: { GET: 'Lucky draws', POST: 'Add a draw' },
    answer: 'adminList',
  },
  drawRun: { path: `${A}/draws/{id}/run`, capability: 'admin.draws', methods: { POST: 'Run a draw' } },
  drawCancel: {
    path: `${A}/draws/{id}/cancel`,
    capability: 'admin.draws',
    methods: { POST: 'Cancel a draw' },
  },
  offers: {
    path: `${A}/offers`,
    capability: 'admin.offers',
    methods: { GET: 'Offers', POST: 'Add an offer' },
    answer: 'adminList',
  },
  offerEnd: { path: `${A}/offers/{id}/end`, capability: 'admin.offers', methods: { POST: 'End an offer' } },
  // engagement studio
  tasks: {
    path: `${A}/engagement/tasks`,
    capability: 'admin.engagement',
    methods: { GET: 'Tasks', POST: 'Add a task' },
    answer: 'adminList',
  },
  task: {
    path: `${A}/engagement/tasks/{id}`,
    capability: 'admin.engagement',
    methods: { PUT: 'Change a task' },
  },
  ideas: {
    path: `${A}/engagement/ideas`,
    capability: 'admin.engagement',
    methods: { GET: 'Member ideas' },
    answer: 'adminList',
  },
  idea: {
    path: `${A}/engagement/ideas/{id}`,
    capability: 'admin.engagement',
    methods: { POST: 'Decide on an idea' },
  },
  stories: {
    path: `${A}/engagement/stories`,
    capability: 'admin.engagement',
    methods: { GET: 'Stories', POST: 'Add a story' },
    answer: 'adminList',
  },
  story: {
    path: `${A}/engagement/stories/{id}`,
    capability: 'admin.engagement',
    methods: { PUT: 'Change a story' },
  },
  streaks: {
    path: `${A}/engagement/streaks`,
    capability: 'admin.engagement',
    methods: { GET: 'Streak rules and counts' },
  },
  // teens
  teens: {
    path: `${A}/teens`,
    capability: 'admin.teens',
    methods: { GET: 'Teen members' },
    query: LIST,
    answer: 'adminList',
  },
  teen: {
    path: `${A}/teens/{id}`,
    capability: 'admin.teens',
    methods: { GET: 'One teen with guardian status' },
  },
  teenRevokeLinks: {
    path: `${A}/teens/{id}/revoke-links`,
    capability: 'admin.teens',
    methods: { POST: 'Revoke guardian links' },
  },
  teenGraduate: {
    path: `${A}/teens/{id}/graduate`,
    capability: 'admin.teens',
    methods: { POST: 'Move a member who turned 18 to adult terms' },
  },
  teenClose: {
    path: `${A}/teens/{id}/close`,
    capability: 'admin.teens',
    methods: { POST: 'Close when adult terms were not accepted in time' },
  },
  teenRegistrations: {
    path: `${A}/teens/registrations`,
    capability: 'admin.teens',
    methods: { GET: 'Teen registration pipeline' },
    query: LIST,
    answer: 'adminList',
  },
  teenRegistrationAction: {
    path: `${A}/teens/registrations/{id}/{action}`,
    capability: 'admin.teens',
    methods: { POST: 'Approve, cancel or renew a registration' },
    enums: { action: ['approve', 'cancel', 'renew'] },
  },
  // data requests
  dataRequests: {
    path: `${A}/data-requests`,
    capability: 'admin.data_requests',
    methods: { GET: 'Access and deletion requests' },
    query: LIST,
    answer: 'adminList',
  },
  dataRequest: {
    path: `${A}/data-requests/{id}`,
    capability: 'admin.data_requests',
    methods: { GET: 'One request' },
  },
  dataRequestDecision: {
    path: `${A}/data-requests/{id}/decision`,
    capability: 'admin.data_requests',
    methods: { POST: 'Decide on a request' },
  },
};

function expand(specs: Record<string, ResourceSpec>, defaultAuth: Auth, prefix: string): Operation[] {
  return Object.entries(specs).flatMap(([resource, s]) =>
    (Object.entries(s.methods) as [Method, string][]).map(([method, summary]) => ({
      id: `${prefix}${resource}.${method.toLowerCase()}`,
      resource,
      method,
      path: s.path,
      capability: s.capability,
      auth: s.auth ?? defaultAuth,
      summary,
      writes: method !== 'GET',
      ...(s.query ? { query: s.query } : {}),
      ...(s.enums ? { enums: s.enums } : {}),
      ...(s.answer && method === 'GET' ? { answer: s.answer } : {}),
    })),
  );
}

export const SYNC_OPERATIONS: readonly Operation[] = expand(SYNC, 'bearer', '');
export const ADMIN_OPERATIONS: readonly Operation[] = expand(ADMIN, 'signed', 'admin.');
export const OPERATIONS: readonly Operation[] = [...SYNC_OPERATIONS, ...ADMIN_OPERATIONS];

export type SyncResource = keyof typeof SYNC;
export type AdminResource = keyof typeof ADMIN;
export const SYNC_RESOURCES = SYNC as Readonly<Record<string, Readonly<ResourceSpec>>>;
export const ADMIN_RESOURCES = ADMIN as Readonly<Record<string, Readonly<ResourceSpec>>>;

const PARAM = /\{(\w+)\}/g;

/** Fills a path template. Every parameter is URL-encoded; a missing one throws. */
export function fillPath(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(PARAM, (_, k: string) => {
    const v = params[k];
    if (v === undefined || v === '') throw new Error(`Missing path parameter "${k}" for ${template}`);
    return encodeURIComponent(String(v));
  });
}

/** The path of a resource, e.g. `pathOf('admin', 'member', {id})`. */
export function pathOf(
  surface: 'sync' | 'admin',
  resource: string,
  params?: Record<string, string | number>,
): string {
  const spec = (surface === 'sync' ? SYNC : ADMIN)[resource];
  if (!spec) throw new Error(`Unknown ${surface} resource "${resource}" in the panel contract`);
  return fillPath(spec.path, params);
}

interface Compiled {
  op: Operation;
  re: RegExp;
  params: string[];
  literals: number;
}

const compiled: Compiled[] = OPERATIONS.map((op) => {
  const params: string[] = [];
  const segs = op.path.split('/');
  const re = new RegExp(
    '^' +
      segs
        .map((seg) => {
          const m = /^\{(\w+)\}$/.exec(seg);
          if (!m) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          params.push(m[1]!);
          const allowed = op.enums?.[m[1]!];
          return allowed ? `(${allowed.join('|')})` : '([^/]+)';
        })
        .join('/') +
      '$',
  );
  return { op, re, params, literals: segs.length - params.length };
})
  // A literal segment beats a parameter: /members/duplicates is not /members/{id}.
  .sort((a, b) => b.literals - a.literals);

/** Finds the contract operation of a concrete call. The query string is ignored. Null when the route is not in it. */
export function matchOperation(
  method: string,
  pathWithQuery: string,
): { op: Operation; params: Record<string, string> } | null {
  const path = pathWithQuery.split('?')[0]!;
  for (const c of compiled) {
    if (c.op.method !== method.toUpperCase()) continue;
    const m = c.re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      c.params.forEach((p, i) => (params[p] = decodeURIComponent(m[i + 1]!)));
      return { op: c.op, params };
    }
  }
  return null;
}
