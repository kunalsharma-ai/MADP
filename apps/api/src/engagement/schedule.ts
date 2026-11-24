/** Local hour (0-23) of an instant in a time zone; UTC when the zone is missing or unknown. */
export function localHour(at: Date, timeZone: string | null | undefined): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timeZone || 'UTC' })
      .formatToParts(at)
      .find((p) => p.type === 'hour')?.value;
    return Number(h);
  } catch {
    return at.getUTCHours();
  }
}

export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

const QUARTER = 15 * 60_000;

/**
 * The first moment at or after `from` that is outside the member's quiet hours, on a quarter-hour boundary once it
 * has to wait (time zones can be offset by 30 or 45 minutes).
 */
export function nextSendTime(from: Date, timeZone: string | null | undefined, start: number, end: number): Date {
  let t = new Date(from);
  for (let i = 0; i < 100 && inQuietHours(localHour(t, timeZone), start, end); i++) {
    t = new Date(Math.floor(t.getTime() / QUARTER + 1) * QUARTER);
  }
  return t;
}

/** The calendar date (YYYY-MM-DD) of an instant in a time zone; UTC when the zone is missing or unknown. */
export function localDate(at: Date, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timeZone || 'UTC' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Whether a date of birth (YYYY-MM-DD) falls on `today` (YYYY-MM-DD). 29 February is greeted on 28 February in other years. */
export function isBirthday(dob: string, today: string): boolean {
  const md = dob.slice(5, 10);
  if (md === today.slice(5, 10)) return true;
  const y = Number(today.slice(0, 4));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === '02-29' && !leap && today.slice(5, 10) === '02-28';
}
