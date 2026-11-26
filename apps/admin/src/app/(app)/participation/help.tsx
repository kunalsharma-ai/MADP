import type { ReactNode } from 'react';
import { TopicInfo, type TopicHelp } from '@/components/screen-info';

/** A card title with its Why / Where / How "i" beside it. */
export function Titled({ title, help, align }: { title: ReactNode; help: TopicHelp; align?: 'left' | 'right' }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {title}
      <TopicInfo title={typeof title === 'string' ? title : 'this part'} help={help} align={align} />
    </span>
  );
}

/** Why / Where / How for each part of the survey participation screen, the member engagement tab and the panellist page. */
export const HELP = {
  panelCard: {
    why: 'Shows at a glance how well each panel turns survey starts into completes, and how many members are taking part.',
    where: 'Counted from the survey responses each panel sends to MADP at every sync. The panel itself is never changed.',
    how: [
      'The ring is the complete rate: completes divided by surveys that ended (complete, terminate or quota full).',
      'Members counts each panel account once, however many surveys it took.',
      'Points given adds up the points from completed surveys only.',
      'Pick a result or a panel below and every number on the screen follows that filter.',
    ],
  },
  filters: {
    why: 'Narrows the whole screen to the surveys you care about.',
    where: 'The result tabs, panel buttons and survey name search above the records.',
    how: [
      'Pick a result (for example Terminate) to see only those records. The counts show how many there are.',
      'Pick a panel to see one panel, or All panels to see all three.',
      'Type part of a survey name and press Find. Health survey names on MHO stay hidden unless you have health access.',
    ],
  },
  records: {
    why: 'One line for every survey a member started on any panel: when, which survey, the result, points and length.',
    where: 'Mirrored from each panel’s responses feed. Rows carry the panel’s member ID, never a name.',
    how: [
      'Newest first, 50 to a page. Use the page buttons at the bottom.',
      'Click a member ID to open their full history and engagement score.',
      'Length is the time the panel reported for the survey, in minutes.',
    ],
  },
  topSurveys: {
    why: 'Shows which surveys get the most attempts, so you can spot a busy or a troubled survey quickly.',
    where: 'Counted from the same records and filters as the list.',
    how: ['The bar is the number of attempts. "done" is how many of them completed.', 'Change the filters above and this list follows.'],
  },
  memberSurveys: {
    why: 'How this member does on surveys on this panel.',
    where: 'Read live from the panel’s own member area data for this member.',
    how: ['The ring is the complete rate.', 'Completes and terminates are counted over all of this member’s surveys on this panel.'],
  },
  memberPoints: {
    why: 'The member’s point balance, exactly as they see it in their own member area.',
    where: 'Read live from the panel’s points ledger. Nothing is recalculated in MADP.',
    how: [
      'Available can be redeemed now. Pending is waiting to clear, and on hold is held for a check.',
      'To approve or reverse points, use the Overview & actions tab.',
    ],
  },
  memberStreak: {
    why: 'Shows how regularly the member comes back, which is a strong sign of engagement.',
    where: 'Worked out by the panel from the days the member was active.',
    how: ['Each bar is one of the last 28 days, and coloured bars are active days.', 'The line below shows the next streak bonus and how many days are left to earn it.'],
  },
  memberReferrals: {
    why: 'How many friends this member brought in, and how far those friends got.',
    where: 'Read from the panel’s referral records. Teens have no referrals.',
    how: ['Friends joined counts sign-ups with this member’s link.', 'The list at the bottom of the tab shows each friend and the stage they reached.'],
  },
  memberRecords: {
    why: 'Every survey this member took on this panel, with the result and points.',
    where: 'Read live from the panel. MHO survey names stay hidden unless you have health access.',
    how: ['Newest first, 25 to a page.', 'Rating is the stars the member gave the survey, if they rated it.'],
  },
  memberAlerts: {
    why: 'Changes the member’s alert settings for them, for example when they ask support to stop e-mails.',
    where: 'Saved straight to the panel, the same way the member would change them in their member area.',
    how: [
      'Turn switches on or off, set quiet hours and the weekly invite limit.',
      'Write a reason (at least 5 characters). It goes to the audit log with your name.',
      'Press Save alert settings. Teen accounts are changed from the Teen module.',
    ],
  },
  memberPayout: {
    why: 'Shows how this member gets paid, and lets you clear the saved method if the account may have been taken over.',
    where: 'Only the method name and masked destinations come from the panel. Full account details never leave it.',
    how: [
      'Clear payout method removes the saved method. The member picks a new one at their next reward request.',
      'Rewards already requested keep their destination.',
      'A reason is required and is written to the audit log.',
    ],
  },
  memberFriends: {
    why: 'The people who joined with this member’s referral link.',
    where: 'Read from the panel’s referral records.',
    how: ['Click a name to open that member.', 'The badge shows how far they got: joined, e-mail verified or took a survey.'],
  },
  personEngagement: {
    why: 'One score per panel that says how active this person is, so you can find your best and your fading members.',
    where: 'Worked out in MADP from this person’s survey records on each panel. Each panel is scored on its own.',
    how: [
      'The score is out of 100: recent activity counts for 50, complete rate for 30, and how many surveys they finished (up to 10) for 20.',
      'Bands: very active is 70 or more, active is 45 or more, cooling is 20 or more, and anything lower is inactive.',
      'All survey records opens the full list for every member.',
    ],
  },
} satisfies Record<string, TopicHelp>;
