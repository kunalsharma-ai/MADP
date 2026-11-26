/**
 * The "i" help of every console screen: why it exists, where its data comes from and where it acts, and how to use
 * it. Keyed by the screen's menu path; a detail page (e.g. /members/123) uses its parent's entry. A test checks that
 * every menu entry has one (screen-help.test.ts).
 */
export interface ScreenHelp {
  why: string;
  where: string;
  how: string[];
}

export const SCREEN_HELP: Record<string, ScreenHelp> = {
  '/': {
    why: 'One view of the whole audience: how many unique people MADP holds and how they spread over panels and segments.',
    where: 'MADP’s own database, filled by each panel’s sync. People are counted once across all panels; DEMO data is never mixed into live counts.',
    how: [
      'Read the unique-people total first; panel and segment memberships are shown beside it, not added to it.',
      'Use the brand switcher at the top to look at one panel.',
      'Open Audience explorer or Geography to dig into a number.',
    ],
  },
  '/insights': {
    why: 'Points you to things worth acting on (a drop in sign-ups, stale profiles) using fixed, documented rules.',
    where: 'Computed from MADP’s own counts, panel by panel. Nothing is changed automatically.',
    how: ['Open an insight to see the rule and numbers behind it.', 'Accept or dismiss it with a reason; the decision is audited.'],
  },
  '/reports': {
    why: 'Download the standard reports for meetings, clients or checks.',
    where: 'MADP’s database. One table per panel, never summed across panels. Every download is recorded in the security audit.',
    how: ['Pick a report and the panels.', 'Choose CSV or Excel and download. Every row carries its data mode (DEMO or live).'],
  },
  '/audience': {
    why: 'Answer “how many people do we have who…” across panels, segments, countries and profile answers.',
    where: 'MADP’s unique-person counts. Small cells are hidden; health answers need the health permission and a stated purpose.',
    how: [
      'Tick panels, segments and countries, and add answer filters if needed.',
      'Read the unique-people total; memberships per panel and segment are shown beside it.',
      'Save the filter as an audience on Segments & audiences if you will reuse it.',
    ],
  },
  '/audience-segments': {
    why: 'Decide which segments MADP has (Consumers, Professionals, Patients, Caregivers, Teens and your own) and how each panel’s member category joins them.',
    where: 'MADP’s segment list and rules. Sync applies the rules to new and updated members; counts, filters, Supply360 and campaigns use the segments.',
    how: [
      'Add a segment, then add a rule linking a panel’s category value (for example “b2c”) to it.',
      'Rename or reorder with Edit. Archive to hide a segment and stop new members joining; Restore brings it back.',
      'Delete works only while a segment has no members. Built-in segments can’t be deleted, and Teens always stays a minors segment.',
    ],
  },
  '/geo': {
    why: 'See where people live and how panels and segments overlap.',
    where: 'MADP’s unique-person records; each person is placed once by source precedence. Small cells are hidden.',
    how: ['Filter by panel and segment.', 'Read the country, state and city tables, then the overlap grid.'],
  },
  '/panellists': {
    why: 'Find a person across all panels and see their memberships in one place.',
    where: 'MADP’s unique-person records. Contact details are masked; opening a profile is logged.',
    how: ['Search or filter by panel, segment or minor status.', 'Open a person to see each panel account, consent and answers you are allowed to see.'],
  },
  '/identity': {
    why: 'Review accounts on different panels that look like the same person.',
    where: 'MADP’s match suggestions. Merging joins people, never panels: each panel keeps its own membership, consent and rewards.',
    how: ['Compare the two records.', 'Merge or keep apart with a reason. Every merge can be undone.'],
  },
  '/members': {
    why: 'Look up and help a member of the brand picked at the top.',
    where: 'The panel itself, through its signed admin API. E-mail and phone stay masked unless you have the PII permission and give a reason.',
    how: [
      'Search by name, id, e-mail or phone, or type in the filter under any column heading and press Enter.',
      'Click a column name to sort by it; click again to flip the order.',
      'The New members tile at the top counts sign-ups since you last pressed Seen. The bell at the top right shows every panel, with a sound.',
      'Open the member to see points, profiles and history, or to make an audited change.',
    ],
  },
  '/question-bank': {
    why: 'Keep the brand’s question library: wording, options and rules.',
    where: 'The panel’s question bank, through its admin API. Teen guardrails are enforced by the panel.',
    how: [
      'Search a question and open it to edit; the key never changes once answered.',
      'Import a JSON or Excel bank: it is a dry run until you choose to write.',
    ],
  },
  '/profiles': {
    why: 'Set which profiles each segment sees, in what order, and the points they pay.',
    where: 'The panel’s profiles, through its admin API.',
    how: ['Pick a segment.', 'Reorder, switch profiles on or off, and set points (empty means the default of 50).'],
  },
  '/questionnaires': {
    why: 'Change a profile’s pages, questions and show-if logic safely.',
    where: 'Drafts stay in MADP; after a second admin approves, the change is written to the panel.',
    how: ['Open a profile and edit its draft.', 'Ask a second admin to approve; only then does the panel receive it.'],
  },
  '/segments': {
    why: 'Manage the panel’s own sign-up segments and saved audiences.',
    where: 'The panel’s segments, through its admin API. MADP’s cross-panel segments are on Audience segments.',
    how: ['Change a segment’s sign-up rules with a reason (they apply to new sign-ups).', 'Build an audience from filters and count it.'],
  },
  '/surveys': {
    why: 'See the brand’s surveys and invite members to one.',
    where: 'The panel’s surveys, through its admin API. Inviting never sends e-mail while the e-mail switch is off.',
    how: ['Open a survey.', 'Count invitations in a dry run first, then invite.'],
  },
  '/points': {
    why: 'Second-person check on large points changes.',
    where: 'The panel’s points ledger. Changes at or above the brand’s four-eyes amount wait here.',
    how: ['Open a waiting adjustment.', 'Approve or reject it; you can’t decide your own.'],
  },
  '/quality': {
    why: 'Spot low-quality members and suspicious referral patterns.',
    where: 'The panel’s quality scores and referrals. Nothing here changes data.',
    how: ['Sort by score.', 'Change a score on the member page, with a rule and a note.'],
  },
  '/experts': {
    why: 'Verify professionals who asked to be shown as experts.',
    where: 'The panel’s expert requests. Every look and decision is audited; nothing is e-mailed.',
    how: ['Check the LinkedIn profile and work e-mail domain by hand.', 'Verify, or decline with a note the member sees.'],
  },
  '/rewards': {
    why: 'Handle redemptions, the catalogue, prize draws and bonus offers.',
    where: 'The panel’s rewards. Nothing pays anyone: “Mark paid” records a payment the team made by hand.',
    how: ['Work through the redemption queue.', 'Edit the catalogue and offers; large payments need a second admin.'],
  },
  '/prize-machines': {
    why: 'Set up the claw, lift and spiral prize games per segment.',
    where: 'The panel. Members see a machine only while it is live, their country is cleared and the Prize machines switch is on.',
    how: ['Set prizes, odds, plays per day and countries.', 'Save with a reason.'],
  },
  '/engagement': {
    why: 'Run polls, teen creative tasks, challenges, ideas, stories and streaks.',
    where: 'The panel. Teen copy may not mention money; teen ideas are seen only by moderators until approved.',
    how: ['Pick a feature tab.', 'Create, moderate or switch items on and off.'],
  },
  '/teens': {
    why: 'Handle members turning 18: guardian consent ends and the adult terms must be accepted.',
    where: 'The panel’s teen accounts. Guardian details are masked.',
    how: ['See who turns 18 soon and who is paused.', 'Move a member now or close an account, with a reason.'],
  },
  '/teens/registrations': {
    why: 'Follow every Teen Panel registration and unblock stuck ones.',
    where: 'The panel’s registration pipeline. Only the transitions the panel allows are offered.',
    how: ['Filter by status.', 'Approve a manual review, cancel, or renew an expired guardian invitation, with a reason.'],
  },
  '/data-requests': {
    why: 'Handle members’ requests to delete their account and data.',
    where: 'The panel’s requests. The console never deletes: the deletion is carried out by the runbook.',
    how: ['Approve once nothing blocks it (an open reward request does).', 'Carry it out by the runbook, then mark it done.'],
  },
  '/tickets': {
    why: 'Answer member questions for the brand picked at the top.',
    where: 'The panel’s support desk. Replies show in the member’s Support page; internal notes never do.',
    how: ['Open a ticket.', 'Reply, add an internal note, or change its status.'],
  },
  '/messages': {
    why: 'Post a message to members’ bell and Messages page.',
    where: 'The panel. Messages are never e-mailed. Teens get only messages aimed at the teen segment.',
    how: ['Pick a filter or saved audience.', 'Write and send; the count is shown first.'],
  },
  '/help-centre': {
    why: 'Add questions and answers to the member Help centre.',
    where: 'The panel’s Help centre, next to the built-in guides. Teen-visible entries may not mention money.',
    how: ['Add or edit an entry as a draft.', 'Publish when ready.'],
  },
  '/content': {
    why: 'Edit the brand’s privacy, terms, cookie and other site pages.',
    where: 'The panel’s site. Until a page is published, the site shows its built-in text. Legal pages need a second admin.',
    how: ['Open a page and edit the draft.', 'Publish (or ask a second admin for a legal page).'],
  },
  '/questions': {
    why: 'See every question from every panel by segment and profile, and add or change profile questions.',
    where: 'MADP’s question registry, filled by sync. Edits go to each panel’s question bank through its admin API; nothing is merged across panels without an approved mapping.',
    how: [
      'Search by text or panel, or open a segment and a profile.',
      'Press Edit on a question, or Add a question.',
      'Tick the panels and segments, pick the kind of question, its answers, its rules and what it depends on, then save.',
    ],
  },
  '/mappings': {
    why: 'Link each panel’s question to one MADP attribute, so answers can be compared across panels.',
    where: 'MADP. Suggestions only; a person confirms every mapping.',
    how: ['Review a suggestion.', 'Approve, reject or ask for more information.'],
  },
  '/freshness': {
    why: 'See how complete and recent profiles are, and who is due for a check.',
    where: 'MADP’s copy of each panel’s answers. Counts only, panel by panel.',
    how: ['Pick a panel.', 'Read the least-answered questions and the members due for their 6-month check.'],
  },
  '/verification': {
    why: 'See e-mail, phone and quality checks, and record independent verification.',
    where: 'What each panel reports plus MADP’s own checks. One admin records, another decides.',
    how: ['Read the checks per panel.', 'Record evidence or decide someone else’s.'],
  },
  '/connectors': {
    why: 'Check that each panel’s sync is healthy and see what it brought in.',
    where: 'MADP’s connectors. A panel runs on DEMO data until live sync is approved and its connection is set.',
    how: ['Read each panel’s mode and health.', 'Run an import or sync and open its reconciliation.'],
  },
  '/panels': {
    why: 'Add, edit, archive, restore or delete the panels (brands) MADP serves.',
    where: 'MADP’s panel list. T2O, MFR and MHO are built in and can’t be archived or deleted.',
    how: [
      'Add a panel and choose whether it runs on the shared backend or is another network on other software.',
      'Then set its connection on Panel connections (and, for a network, send data on Networks).',
      'Archive stops sync and hides it; Restore brings it back. Delete works only while it holds no data.',
    ],
  },
  '/networks': {
    why: 'Bring in a panel network that runs on other software, without a developer.',
    where: 'An encrypted inbox per network in MADP. The normal sync reads it, with matching, consent and audit.',
    how: [
      'Approve live sync for the network on Panel connections.',
      'Upload a CSV or Excel file: check it first, then import. Or make a push key for the network’s system.',
      'Add an Audience segments rule for each of its category values.',
    ],
  },
  '/panel-connections': {
    why: 'Tell MADP how to reach each panel, and approve live sync, without server settings.',
    where: 'MADP. Tokens are stored encrypted and never shown again. A second Super Admin approves changes when one exists.',
    how: ['Edit a panel’s addresses and tokens, then Test connection.', 'Turn on live sync when the owner approves reading real member data.'],
  },
  '/communications': {
    why: 'Prepare templates and campaigns for each panel’s own brand.',
    where: 'MADP. A second person approves every version. Runs are dry runs; nothing is sent.',
    how: ['Create a template, then a campaign.', 'Run it as a dry run to see who would get it and why others would not.'],
  },
  '/communications/mailers': {
    why: 'Browse the panels’ own e-mail templates from the mailer packs.',
    where: 'The imported mailer packs. Nothing is sent from this screen.',
    how: ['Filter by panel or kind.', 'Open a template to preview it with sample values.'],
  },
  '/communications/automations': {
    why: 'Set up lifecycle rules such as win-back, onboarding and birthdays.',
    where: 'MADP. A second person approves every version. Runs are dry runs; nothing is sent.',
    how: ['Create a rule for one panel.', 'Have it approved, then run it dry to check who it reaches.'],
  },
  '/participation': {
    why: 'See every survey each member started or finished on T2O, MFR and MHO, with the result and the points it earned.',
    where: 'A read-only copy of each panel’s survey responses, refreshed on every sync. Panels are shown side by side, never added together.',
    how: [
      'Pick a panel or a result (Complete, Terminate…) to narrow the list.',
      'Type part of a survey name to find who took it.',
      'Click a member to open their 360° profile with their engagement score and full history.',
    ],
  },
  '/loyalty': {
    why: 'See each panel’s reward wallets and approve survey completes for payment.',
    where: 'A read-only mirror of the panels’ wallets. Panels are never added together; nothing here changes a wallet.',
    how: ['Pick a panel.', 'Record client approval of completes that are pending.'],
  },
  '/supply360': {
    why: 'Manage the Supply360 service clients that ask MADP for counts and eligibility.',
    where: 'MADP. Supply360 gets counts and pseudonymous references only, never names, answers or health data.',
    how: ['Create a client and give it scopes.', 'Rotate or revoke its secret when needed.'],
  },
  '/consent': {
    why: 'See consent as each panel reports it, and members’ channel opt-outs.',
    where: 'MADP’s consent records with full history. MADP never grants consent itself.',
    how: ['Filter by panel and purpose.', 'Open a person’s history for the evidence.'],
  },
  '/privacy': {
    why: 'Handle access, correction, deletion and restriction requests on time.',
    where: 'MADP, with a trail nobody can edit. The person who logs a request never verifies or carries it out.',
    how: ['Log the request.', 'Verify it (another admin), then carry it out before the due date.'],
  },
  '/audit': {
    why: 'Check who did what, and prove nothing was changed afterwards.',
    where: 'MADP’s append-only, hash-chained audit log. Personal data in values is masked.',
    how: ['Filter by action, actor or date.', 'Run the chain check to confirm no entry was changed or removed.'],
  },
  '/admins': {
    why: 'Manage who can use the console and what they may do.',
    where: 'MADP’s admin accounts and roles. You can only grant what you hold yourself.',
    how: ['Add an admin and give roles brand by brand (or all brands).', 'Edit roles or disable an account with a reason.'],
  },
  '/brands': {
    why: 'Set each brand’s name, hostnames, sender and money settings.',
    where: 'MADP’s brand settings. Money settings are Super Admin only and need a reason.',
    how: ['Open a brand.', 'Change a setting and save with a reason.'],
  },
  '/switches': {
    why: 'Turn money, legal and e-mail features on or off per brand, segment or country.',
    where: 'MADP; the panel checks a switch when it acts, so a change applies within ten seconds.',
    how: ['Pick a feature.', 'Set it for the brand, a segment or a country, with a reason. The kill switch beats every rule.'],
  },
};

/** The entry for a path: the exact menu path, else the longest menu path it starts with. */
export function helpFor(path: string): { key: string; help: ScreenHelp } | null {
  if (SCREEN_HELP[path]) return { key: path, help: SCREEN_HELP[path] };
  const key = Object.keys(SCREEN_HELP)
    .filter((k) => k !== '/' && path.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? { key, help: SCREEN_HELP[key]! } : null;
}
