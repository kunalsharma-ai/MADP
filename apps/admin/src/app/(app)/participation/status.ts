/** Plain names and colours for the survey results the panels report. */
export const STATUS_LABEL: Record<string, string> = {
  complete: 'Complete',
  terminate: 'Terminate',
  quota_full: 'Quota full',
  started: 'Started',
  invited: 'Invited',
};
export const STATUS_TONE: Record<string, 'teal' | 'danger' | 'warn' | 'accent' | 'neutral'> = {
  complete: 'teal',
  terminate: 'danger',
  quota_full: 'warn',
  started: 'accent',
  invited: 'neutral',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replaceAll('_', ' ');
