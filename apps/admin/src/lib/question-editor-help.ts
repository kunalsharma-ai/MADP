import type { QuestionSetting } from '@madp/contracts';
import type { TopicHelp } from '@/components/screen-info';

/** Why / Where / How for every part of the question editor (Question registry → Edit or Add a question). */
export const EDITOR_SECTION_HELP = {
  where: {
    why: 'Decide which member sites ask this question and which members see it.',
    where: 'Each ticked panel’s question bank (T2O, MFR, MHO). Segments become each panel’s own category words through the rules on the Audience segments screen.',
    how: [
      'Tick a panel card. “Already asked here” means saving updates it; “Not asked here yet” means saving adds it.',
      'Pick one or more segments. The chips show which panels have that segment.',
      'Check “What each panel gets”. Use “Change panel words” only if a panel needs a different word.',
    ],
  },
  kind: {
    why: 'The kind decides how the member answers: pick from a list, type, give an e-mail or phone, a number or date, or upload a file.',
    where: 'Stored on the question in each panel, in the word that panel already uses (for example MFR stores short text as “open end single line”).',
    how: [
      'Pick a tile. Its description says what the member sees.',
      'A greyed tile says “Not shown on …”: that member site doesn’t show this kind, so it can’t be added there and the site’s design stays the same.',
      'Pick from answers kinds open the Answers section below.',
    ],
  },
  wording: {
    why: 'What the member reads, and the key that links every answer to this question.',
    where: 'The question’s label, help text and admin label in each ticked panel. Translations are on the Question bank screen.',
    how: [
      'For a new question, type a short key such as pet-ownership. It can’t change later.',
      'Write the question wording, and optional help text shown under it.',
      'The admin label is only for admins, to tell similar questions apart.',
    ],
  },
  answers: {
    why: 'The list of answers the member picks from.',
    where: 'The question’s options in each ticked panel. Every ticked panel gets this same list.',
    how: [
      'Type an answer and press Add. Its stored value is made for you.',
      'Change wording any time; stored values of existing answers stay the same so old answers keep their meaning.',
      'Remove an answer with the bin: the panel retires it, it is not deleted.',
    ],
  },
  rules: {
    why: 'Whether the member must answer, and the extra choices this kind of question supports.',
    where: 'The question’s rule switches in each ticked panel. The blue line shows the answer this kind expects.',
    how: [
      'Turn Required off to let members leave it empty.',
      'Switch on Other, None or Prefer not to say to add those answers.',
      'When Teens is picked, set the subject honestly: the panel refuses adult subjects for teens.',
    ],
  },
  dependency: {
    why: 'Ask a question only when it makes sense, for example “How many children?” only after “Do you have children?”.',
    where: 'The question’s parent, and each answer’s “shown for” list, in each ticked panel. The Question bank’s Show-when rules tab lists any rule that points at something missing.',
    how: [
      'Type the earlier question’s key, or search for it, then press “Load its answers”.',
      'For an answer list, tick the parent answers that should show this question. None ticked means any answer.',
      'Different conditions per answer can be set in the Answers table. Remove the dependency to always show it.',
    ],
  },
  attribute: {
    why: 'Link the question to a shared attribute so answers from T2O, MFR and MHO can be compared and counted together.',
    where: 'MADP’s mapping for this question (the same decision as the Mapping workbench). Profile pages live in the Questionnaire builder.',
    how: [
      'Pick an attribute for each panel and press Link.',
      'A new question appears here after the next sync; link it then.',
      'To place it on a profile page, open the Questionnaire builder: a second admin reviews page changes.',
    ],
  },
  save: {
    why: 'Write the change to every ticked panel at once.',
    where: 'Each panel’s question bank. Every write is checked for your access on that panel and kept in the audit log.',
    how: [
      'Add a reason so others know why it changed.',
      'Press Save. The button stays off and says what is missing until the question is ready.',
      'Read the result for each panel: a panel can refuse a change (for example a teen guardrail) while others save.',
    ],
  },
} satisfies Record<string, TopicHelp>;

export const SETTING_HELP: Record<QuestionSetting, TopicHelp> = {
  isRequired: {
    why: 'Makes sure every member answers this question.',
    where: 'The question’s Required switch in each ticked panel.',
    how: ['On: the member can’t go on without an answer.', 'Off: the member may leave it empty.'],
  },
  isEditable: {
    why: 'Lets members correct or update their answer later, for example when their job changes.',
    where: 'The question’s “can edit” switch in each ticked panel.',
    how: ['On: the member can change the answer in their profile.', 'Off: the first answer is kept.'],
  },
  hasOthers: {
    why: 'Catches answers you didn’t list.',
    where: 'The question’s Other switch in each ticked panel; the typed text is kept with the answer.',
    how: ['Switch on to add “Other (please specify)” with a text box.'],
  },
  hasNone: {
    why: 'Gives members an honest way to say none of the answers apply.',
    where: 'The question’s None switch in each ticked panel.',
    how: ['Switch on to add “None of these”.', 'For tick boxes, it clears the other answers.'],
  },
  hasSkip: {
    why: 'Respects members who don’t want to answer a personal question.',
    where: 'The question’s Skip switch in each ticked panel.',
    how: ['Switch on to add “Prefer not to say”.'],
  },
  isMoney: {
    why: 'Marks income or spend questions so amounts are read in the member’s currency.',
    where: 'The question’s Money switch in each ticked panel.',
    how: ['Switch on for income, salary or spend questions only.'],
  },
};

export const EXTRA_HELP = {
  panelWords: {
    why: 'Each panel stores segments in its own words, for example T2O’s teens are “minor” and MHO’s are “minor patient”.',
    where: 'The question’s category list in each ticked panel.',
    how: ['Usually leave it: the words come from the segment rules.', 'Change them only if a panel uses a word the rules don’t know yet.'],
  },
  exclusive: {
    why: 'An answer like “None of these” shouldn’t be ticked together with other answers.',
    where: 'The answer’s “exclusive” flag in each ticked panel.',
    how: ['Tick “Clears the others” on that answer.', 'When a member picks it, the other ticks are cleared.'],
  },
  countries: {
    why: 'Some answers only make sense in some countries, such as a state, a bank or a local brand.',
    where: 'The answer’s country list in each ticked panel.',
    how: ['Type two-letter codes such as IN, US, separated by commas.', 'Leave empty to show the answer everywhere.'],
  },
} satisfies Record<string, TopicHelp>;

/** The Question registry's own views and buttons. */
export const REGISTRY_HELP = {
  views: {
    why: 'See the same questions three ways, depending on what you are looking for.',
    where: 'MADP’s copy of each panel’s questions, refreshed by sync.',
    how: [
      'By segment & profile: open a segment, then a profile, to see its questions in order.',
      'By attribute, all panels: one row per shared attribute, with the question that feeds it on T2O, MFR and MHO side by side.',
      'Plain list: every question in a table, with its version, sensitivity and mapping.',
    ],
  },
  addEdit: {
    why: 'Ask a new profile question, or change one, on any member site without a developer.',
    where: 'Add a question opens an empty editor; the Edit button beside every question opens it for that panel. Saving writes to each panel you tick.',
    how: [
      'Press Add a question, or Edit beside a question.',
      'Fill in the numbered steps; each one has its own “i”.',
      'Save at the bottom. The registry shows the change after the next sync.',
    ],
  },
} satisfies Record<string, TopicHelp>;
