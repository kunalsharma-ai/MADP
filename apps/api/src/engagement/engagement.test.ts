import { describe, expect, it } from 'vitest';
import { lintTemplate, render } from './render.js';
import { inQuietHours, localHour, nextSendTime } from './schedule.js';
import { fatigueScore } from './fatigue.js';

describe('templates', () => {
  const ok = {
    subject: 'Hello {{firstName}}',
    bodyHtml: '<p>Hi {{firstName}}</p><a href="{{unsubscribeUrl}}">x</a><a href="{{preferencesUrl}}">y</a>',
    bodyText: 'Hi {{firstName}} {{unsubscribeUrl}} {{preferencesUrl}}',
  };
  it('needs unsubscribe and preference links unless it is a service message', () => {
    expect(lintTemplate('newsletter', ok)).toEqual([]);
    const bare = { ...ok, bodyText: 'Hi' };
    expect(lintTemplate('newsletter', bare)).toEqual([
      'The text part needs {{unsubscribeUrl}}',
      'The text part needs {{preferencesUrl}}',
    ]);
    expect(lintTemplate('service', bare)).toEqual([]);
  });
  it('refuses unknown placeholders, scripts and inline handlers', () => {
    const bad = { ...ok, bodyHtml: `${ok.bodyHtml}{{password}}<script>x</script><img onerror="x">` };
    expect(lintTemplate('newsletter', bad)).toEqual([
      'Unknown placeholder {{password}}',
      'Script tags are not allowed in e-mail',
      'Inline event handlers are not allowed in e-mail',
    ]);
  });
  it('escapes values in HTML', () => {
    const r = render(ok, { firstName: '<b>Ana</b>' });
    expect(r.html).toContain('Hi &lt;b&gt;Ana&lt;/b&gt;');
    expect(r.text).toContain('Hi <b>Ana</b>');
  });
});

describe('quiet hours', () => {
  it('wraps across midnight', () => {
    expect(inQuietHours(22, 21, 8)).toBe(true);
    expect(inQuietHours(7, 21, 8)).toBe(true);
    expect(inQuietHours(8, 21, 8)).toBe(false);
    expect(inQuietHours(12, 9, 17)).toBe(true);
  });
  it('moves a send out of the member’s local night', () => {
    // 18:00 UTC is 23:30 in Kolkata: wait until 08:00 local, 02:30 UTC.
    const t = nextSendTime(new Date('2026-11-24T18:00:00Z'), 'Asia/Kolkata', 21, 8);
    expect(localHour(t, 'Asia/Kolkata')).toBe(8);
    expect(t.toISOString()).toBe('2026-11-25T02:30:00.000Z');
    // Outside quiet hours: unchanged. Unknown zone: treated as UTC.
    const noon = new Date('2026-11-24T12:00:00Z');
    expect(nextSendTime(noon, 'Europe/London', 21, 8)).toEqual(noon);
    expect(localHour(noon, 'Not/AZone')).toBe(12);
  });
});

describe('fatigue score', () => {
  it('shows its factors and bands, and treats an opt-out separately', () => {
    const f = fatigueScore({ messages30d: 4, unanswered30d: 3, complaints: 0, optedOut: false }, { high: 60, medium: 30 });
    expect(f.score).toBe(55);
    expect(f.band).toBe('medium');
    expect(f.factors.map((x) => x.points)).toEqual([40, 15, 0]);
    expect(fatigueScore({ messages30d: 0, unanswered30d: 0, complaints: 0, optedOut: true }, { high: 60, medium: 30 }).band).toBe(
      'opted_out',
    );
  });
});

describe('calendar dates', () => {
  it('uses the member’s local date, and greets 29 February birthdays on 28 February in other years', async () => {
    const { isBirthday, localDate } = await import('./schedule.js');
    const at = new Date('2027-03-01T20:00:00Z');
    expect(localDate(at, 'UTC')).toBe('2027-03-01');
    expect(localDate(at, 'Asia/Kolkata')).toBe('2027-03-02');
    expect(localDate(at, 'Not/AZone')).toBe('2027-03-01');
    expect(isBirthday('1990-03-02', localDate(at, 'Asia/Kolkata'))).toBe(true);
    expect(isBirthday('1992-02-29', '2027-02-28')).toBe(true);
    expect(isBirthday('1992-02-29', '2028-02-28')).toBe(false);
    expect(isBirthday('1992-02-29', '2028-02-29')).toBe(true);
  });
});

describe('contact gate', () => {
  it('applies the rules in order and lets service messages skip the marketing ones', async () => {
    const { gate } = await import('./gate.js');
    const ok = { status: 'active', minor: false, opted_out: false, consent: 'granted', has_email: true, email_rejected: false, bounced: false, week: 0, month: 0 };
    const policy = { maxPerWeek: 2, maxPerMonth: 6 };
    expect(gate(ok, 'marketing', 'email_marketing', policy)).toBeNull();
    expect(gate({ ...ok, minor: true, consent: null }, 'marketing', 'email_marketing', policy)).toBe('minor_excluded');
    expect(gate({ ...ok, minor: true, week: 5 }, 'service', null, policy)).toBeNull();
    expect(gate({ ...ok, week: 2 }, 'onboarding', 'terms', policy)).toBe('frequency_cap_week');
    expect(gate(ok, 'onboarding', 'terms', policy, true)).toBe('already_sent');
    expect(gate({ ...ok, status: 'deleted', opted_out: true }, 'marketing', 'email_marketing', policy)).toBe('membership_not_active');
  });
});
