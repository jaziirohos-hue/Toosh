import { formatMoney, localDate, maskMsisdn, parseAmount } from '@toosh/shared';

/** Money from a canonical API string, e.g. ("3.90", '-') -> "-$3.90". Exact: no floats. */
export function money(value: string | null | undefined, sign: '+' | '-' | 'none' = 'none'): string {
  if (value === null || value === undefined) return '—';
  const r = parseAmount(value, { allowZero: true });
  return r.ok ? formatMoney(r.milli, { sign }) : '—';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function timeOfDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
export function dayLabel(iso: string, tz: string, now = new Date()): { label: string; full: string; key: string } {
  const key = localDate(new Date(iso), tz);
  const today = localDate(now, tz);
  const yesterday = localDate(new Date(now.getTime() - 86400000), tz);
  const [y, m, d] = key.split('-').map(Number);
  const full = `${d} ${MONTHS[m - 1]} ${y}`;
  return { label: key === today ? 'Maanta' : key === yesterday ? 'Shalay' : full, full, key };
}
/** "10:38 AM", "Shalay, 08:30 PM", "24 May, 11:20 AM" */
export function shortDateTime(iso: string, tz: string, now = new Date()): string {
  const day = dayLabel(iso, tz, now);
  const time = timeOfDay(iso, tz);
  if (day.label === 'Maanta') return time;
  if (day.label === 'Shalay') return `Shalay, ${time}`;
  const [, m, d] = day.key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}, ${time}`;
}
export function fullDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}
export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'weli';
  const min = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60000));
  if (min < 1) return 'hadda';
  if (min < 60) return `${min} daqiiqo ka hor`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} saac ka hor`;
  return `${Math.floor(min / 1440)} maalmood ka hor`;
}
export const masked = maskMsisdn;
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || 'T';
}

/** Somali descriptions of parser issues, shown on messages waiting for review. */
export const ISSUE_TEXT: Record<string, string> = {
  NOT_EVC_FORMAT: 'Qaabka fariintu uma eka EVC Plus.',
  NO_DIRECTION: 'Ma cadda in lacagtu soo gashay ama baxday.',
  AMBIGUOUS_DIRECTION: 'Fariintu waxay leedahay ereyo soo galay iyo baxay labadaba.',
  NO_AMOUNT: 'Qaddarka lacagta lama helin.',
  MULTIPLE_AMOUNTS: 'Fariintu waxay leedahay qaddarro kala duwan.',
  AMOUNT_PRECISION: 'Qaddarku wuxuu leeyahay jajab ka badan 3.',
  AMOUNT_INVALID: 'Qaddarka lacagta ma saxna.',
  UNSUPPORTED_CURRENCY: 'Lacagtu ma aha USD.',
  TIME_INVALID: 'Taariikhda fariinta ma saxna.',
  TIME_FAR_FROM_RECEIPT: 'Taariikhda fariinta aad ayay uga fog tahay goorta la helay.',
  COUNTERPARTY_MISSING: 'Magaca ama lambarka qofka lama helin.',
  PHONE_UNREADABLE: 'Lambarka qofka si buuxda looma qorin fariinta.',
  TIME_MISSING: 'Fariintu waqti ma lahan; waqtiga la helay ayaa la isticmaalay.',
  DUPLICATE_REFERENCE: 'Tixraacan horay ayaa loo diiwaangeliyay. Hubi inaanay labanlaab ahayn.',
};
