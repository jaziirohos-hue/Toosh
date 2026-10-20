/**
 * Dates are always computed in the account timezone (default Africa/Mogadishu, UTC+3, no DST).
 * "Today", "this week" (Monday start) and "this month" are calendar periods in that timezone.
 */
export const DEFAULT_TIMEZONE = 'Africa/Mogadishu';

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Calendar parts of an instant in a timezone. */
export function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour: Number(get('hour')), minute: Number(get('minute')), second: Number(get('second')),
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')), // 0 = Monday
  };
}

function offsetMs(utcMs: number, tz: string): number {
  const p = zonedParts(new Date(utcMs), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in a timezone. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = guess - offsetMs(guess, tz);
  utc = guess - offsetMs(utc, tz); // second pass settles DST edges
  return new Date(utc);
}

/** "YYYY-MM-DD" of an instant in a timezone. */
export function localDate(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export type PeriodKind = 'today' | 'week' | 'month' | 'custom';
export interface Period { start: Date; end: Date } // [start, end)

function parseYmd(value: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error('Invalid date');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new Error('Invalid date');
  return [y, mo, d];
}

/**
 * Period boundaries in the account timezone. For "custom", from/to are inclusive local dates (YYYY-MM-DD).
 * Ranges are limited to 400 days so a single request stays bounded.
 */
export function periodRange(kind: PeriodKind, tz: string, now: Date = new Date(), from?: string, to?: string): Period {
  if (kind === 'custom') {
    if (!from || !to) throw new Error('Custom period needs from and to');
    const [fy, fm, fd] = parseYmd(from); const [ty, tm, td] = parseYmd(to);
    const start = zonedTimeToUtc(fy, fm, fd, 0, 0, 0, tz);
    const endDay = new Date(Date.UTC(ty, tm - 1, td + 1));
    const end = zonedTimeToUtc(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), 0, 0, 0, tz);
    if (end <= start) throw new Error('The end date must be on or after the start date');
    if (end.getTime() - start.getTime() > 400 * 86400000) throw new Error('Choose a period of at most 400 days');
    return { start, end };
  }
  const p = zonedParts(now, tz);
  let startDay = new Date(Date.UTC(p.year, p.month - 1, p.day));
  let endDay: Date;
  if (kind === 'today') endDay = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  else if (kind === 'week') {
    startDay = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday));
    endDay = new Date(startDay.getTime() + 7 * 86400000);
  } else {
    startDay = new Date(Date.UTC(p.year, p.month - 1, 1));
    endDay = new Date(Date.UTC(p.year, p.month, 1));
  }
  const at = (d: Date) => zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, 0, tz);
  return { start: at(startDay), end: at(endDay) };
}

export function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
