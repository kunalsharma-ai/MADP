import type { WinBackDays } from '@madp/contracts';

/**
 * Starting copy for the win-back mailers. Each one is only a draft: an admin edits it on Messages and a second admin
 * approves it before any journey can use it. No points or rewards are promised (live rewards need the owner), and
 * nothing in it says or hints at a health fact, so it is the same for every panel.
 */
const COPY: Record<WinBackDays, { subject: string; title: string; lines: string[]; cta: string }> = {
  30: {
    subject: 'We miss you at {{panelName}}',
    title: 'It has been a while, {{firstName | default: "there"}}',
    lines: [
      'We have not seen you on {{panelName}} for about a month, and your opinion still matters to us.',
      'New surveys come in every week. Keeping your profile up to date helps us send you the ones that fit you.',
    ],
    cta: 'Check my profile',
  },
  60: {
    subject: 'New surveys are waiting for you on {{panelName}}',
    title: 'Surveys are waiting, {{firstName | default: "there"}}',
    lines: [
      'There are new surveys on {{panelName}} since your last visit.',
      'It only takes a minute to sign in and see what is open for you.',
    ],
    cta: 'See my surveys',
  },
  90: {
    subject: 'A last reminder from {{panelName}}',
    title: 'Still want to hear from us, {{firstName | default: "there"}}?',
    lines: [
      'You have not been active on {{panelName}} for about three months.',
      'If you would like to keep taking part, sign in any time. If you would rather not get these e-mails, you can change that below.',
    ],
    cta: 'Go to my account',
  },
};

const FOOTER =
  'FREQUENT RESEARCH FIELDWORK SOLUTIONS PRIVATE LIMITED, 70/1/2 Mangolpur Kalan, First Floor, West Enclave, Pitampura, Delhi 110085';

export function winBackDraft(days: WinBackDays): { subject: string; bodyHtml: string; bodyText: string } {
  const c = COPY[days];
  const url = days === 30 ? '{{profileUrl}}' : '{{accountUrl}}';
  const bodyHtml = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
        <tr><td style="background:#4f46e5;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:bold">{{panelName}}</td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 16px;font-size:22px;color:#111827">${c.title}</h1>
${c.lines.map((l) => `          <p style="margin:0 0 14px;font-size:15px;line-height:22px">${l}</p>`).join('\n')}
          <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${c.cta}</a></p>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f9fafb;font-size:12px;line-height:18px;color:#6b7280">
          You get this because you are a member of {{panelName}}.
          <a href="{{preferencesUrl}}" style="color:#4f46e5">E-mail preferences</a> ·
          <a href="{{unsubscribeUrl}}" style="color:#4f46e5">Unsubscribe</a><br>${FOOTER}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;
  const bodyText = [
    c.title,
    '',
    ...c.lines.flatMap((l) => [l, '']),
    `${c.cta}: ${url}`,
    '',
    'You get this because you are a member of {{panelName}}.',
    'E-mail preferences: {{preferencesUrl}}',
    'Unsubscribe: {{unsubscribeUrl}}',
    FOOTER,
  ].join('\n');
  return { subject: c.subject, bodyHtml, bodyText };
}
