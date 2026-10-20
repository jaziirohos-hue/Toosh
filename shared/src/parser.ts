/**
 * Deterministic EVC Plus SMS parser.
 *
 * Rules, in order:
 *  1. Normalise whitespace/line breaks and drop promotional links (they never contribute fields).
 *  2. Find the balance clause ("Haraagaagu waa $51.59") first and set it aside, so the balance is never taken
 *     for the transaction amount.
 *  3. Direction comes ONLY from wording: "… ayaad uwareejisay …" = OUT, "waxaad … ka heshay" = IN.
 *     Both or neither -> manual review. Balance changes are never used to infer direction.
 *  4. Exactly one transaction amount must remain, in USD with at most three decimals.
 *  5. "Tar:/Tariikh: DD/MM/YY HH:MM:SS" is the transaction time, read in the number's timezone. A time far from
 *     the SMS receipt time is treated as suspicious (review). No time -> the receipt time is used and recorded
 *     as a fallback by the caller.
 *
 * The output is suggestion data. Only `autoConfirm === true` lets the server confirm a transaction without a person.
 * Adding a new format = adding a rule here plus a test vector; the version string changes so reprocessing can be
 * tracked.
 */
import { parseAmount } from './money.ts';
import { phoneFromSms } from './phone.ts';
import { DEFAULT_TIMEZONE, zonedTimeToUtc } from './time.ts';
import { hasEvcTag } from './relevance.ts';

export const PARSER_VERSION = 'evc-1.0.0';

export type Direction = 'IN' | 'OUT';
export type ParsedKind = 'TRANSACTION' | 'BALANCE' | 'UNRECOGNIZED';
export type IssueCode =
  | 'NOT_EVC_FORMAT' | 'NO_DIRECTION' | 'AMBIGUOUS_DIRECTION' | 'NO_AMOUNT' | 'MULTIPLE_AMOUNTS'
  | 'AMOUNT_PRECISION' | 'AMOUNT_INVALID' | 'UNSUPPORTED_CURRENCY' | 'TIME_INVALID' | 'TIME_MISSING'
  | 'TIME_FAR_FROM_RECEIPT' | 'BALANCE_INVALID' | 'COUNTERPARTY_MISSING' | 'PHONE_UNREADABLE';

/** Issues that prevent automatic confirmation. The rest are informational. */
export const BLOCKING_ISSUES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  'NOT_EVC_FORMAT', 'NO_DIRECTION', 'AMBIGUOUS_DIRECTION', 'NO_AMOUNT', 'MULTIPLE_AMOUNTS', 'AMOUNT_PRECISION',
  'AMOUNT_INVALID', 'UNSUPPORTED_CURRENCY', 'TIME_INVALID', 'TIME_FAR_FROM_RECEIPT',
]);

export interface ParsedSms {
  parserVersion: string;
  kind: ParsedKind;
  direction: Direction | null;
  amountMilli: bigint | null;
  currency: 'USD' | null;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
  /** ISO instant of the time written in the SMS, or null if the SMS has none. */
  occurredAt: string | null;
  balanceMilli: bigint | null;
  providerRef: string | null;
  autoConfirm: boolean;
  issues: IssueCode[];
}

export interface ParseOptions {
  /** Timezone used to read times written inside the SMS. */
  timeZone?: string;
  /** When the phone received the SMS; used only to sanity-check the SMS's own time. */
  receivedAt?: Date;
  /** Max distance between SMS time and receipt before the time is considered suspicious. */
  maxClockSkewMs?: number;
}

const AMOUNT = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?`;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|so|net|org|ly|me|app)(?:\/\S*)?/gi;
const BALANCE = new RegExp(String.raw`\bhara+g\w*\b[^$\d]{0,20}?` + AMOUNT, 'i');
const OUT_WORDS = /\b(?:ayaad|waxaad|aad)\s+u\s?wareeji(?:say|sey|stay)\b/i;
const IN_WORDS = /\bwaxaad\b.{0,80}?\bka\s?he(?:shay|say|ysay)\b/i;
const OTHER_MONEY_WORDS = /\b(dirtay|bixisay|iibsatay|wareeji\w*|heshay|paid|sent|received|lacag)\b/i;
const SHILLING = /\b\d[\d,.]*\s?(?:slsh|sos|shilin)\b|\b(?:slsh|sos)\s?\d/i;
const TIME = /\b(?:tar(?:iikh(?:da)?)?|taariikh(?:da)?|date)\s*[:.]?\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i;
const REF = /\b(?:ref(?:erence)?|tixraac(?:a)?|aqoonsiga|trx\s?id|txn\s?id|transaction\s+id|id)(?:\s*[:#]\s*|\s+)((?=[A-Z0-9.\-]*\d)[A-Z0-9][A-Z0-9.\-]{3,40})/i;
const SEGMENT_END = /,|;|\s(?:tar(?:iikh\w*)?|taariikh\w*|hara+g\w*|ref\w*|tixraac\w*)\b|\.\s|\.$|$/i;

function normalise(body: string): string {
  return String(body ?? '').replace(LINK, ' ').replace(/[ \s]+/g, ' ').trim();
}

function amountFrom(whole: string, fraction: string | undefined): { milli: bigint | null; issue?: IssueCode } {
  const r = parseAmount(fraction !== undefined ? `${whole}.${fraction}` : whole, { allowZero: true });
  if (r.ok) return { milli: r.milli };
  return { milli: null, issue: r.error === 'PRECISION' ? 'AMOUNT_PRECISION' : 'AMOUNT_INVALID' };
}

/** Name and phone from the text that follows the direction words, e.g. "Qof Tusaale(61XXXXXXX)". */
function counterpartyFrom(segment: string): { name: string | null; phone: string | null; phoneUnreadable: boolean } {
  let rest = segment.trim();
  let phone: string | null = null; let phoneUnreadable = false;
  const tokens = [...rest.matchAll(/\(?\s*(\+?[\dXx*•]{7,15})\s*\)?/g)];
  const last = tokens[tokens.length - 1];
  if (last) {
    phone = phoneFromSms(last[1].replace(/[Xx*•]/g, '?'));
    phoneUnreadable = phone === null;
    rest = (rest.slice(0, last.index) + ' ' + rest.slice((last.index ?? 0) + last[0].length)).trim();
  }
  rest = rest.replace(/[()]/g, ' ').replace(/^[\s,:\-]+|[\s,.:\-]+$/g, '').replace(/\s+/g, ' ');
  const name = /\p{L}/u.test(rest) ? rest.slice(0, 120) : null;
  return { name, phone, phoneUnreadable };
}

function segmentAfter(text: string, index: number): string {
  const tail = text.slice(index);
  const end = SEGMENT_END.exec(tail);
  return tail.slice(0, end ? end.index : tail.length);
}

export function parseEvcSms(body: string, options: ParseOptions = {}): ParsedSms {
  const tz = options.timeZone ?? DEFAULT_TIMEZONE;
  const issues = new Set<IssueCode>();
  const text = normalise(body);
  const result: ParsedSms = {
    parserVersion: PARSER_VERSION, kind: 'UNRECOGNIZED', direction: null, amountMilli: null, currency: null,
    counterpartyName: null, counterpartyPhone: null, occurredAt: null, balanceMilli: null, providerRef: null,
    autoConfirm: false, issues: [],
  };
  if (!hasEvcTag(text) && !/\bevc\s*-?\s*plus\b/i.test(text)) issues.add('NOT_EVC_FORMAT');

  // 2. Balance clause.
  let work = text;
  const balance = BALANCE.exec(text);
  if (balance) {
    const b = amountFrom(balance[1], balance[2]);
    if (b.milli === null) issues.add('BALANCE_INVALID'); else result.balanceMilli = b.milli;
    work = text.slice(0, balance.index) + ' ' + text.slice(balance.index + balance[0].length);
  }

  // 5. Time.
  const time = TIME.exec(work);
  if (time) {
    const [, d, mo, y, h, mi, s] = time;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const valid = h !== undefined && Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(h) <= 23 && Number(mi) <= 59 && Number(s ?? 0) <= 59
      && new Date(Date.UTC(year, Number(mo) - 1, Number(d))).getUTCDate() === Number(d);
    if (!valid) issues.add('TIME_INVALID');
    else {
      const at = zonedTimeToUtc(year, Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0), tz);
      result.occurredAt = at.toISOString();
      if (options.receivedAt && Math.abs(options.receivedAt.getTime() - at.getTime()) > (options.maxClockSkewMs ?? 3 * 86400000)) issues.add('TIME_FAR_FROM_RECEIPT');
    }
    work = work.slice(0, time.index) + ' ' + work.slice(time.index + time[0].length);
  } else issues.add('TIME_MISSING');

  // 6. Provider reference (rarely present in EVC Plus SMS).
  const ref = REF.exec(work);
  if (ref) result.providerRef = ref[1].replace(/[.\-]+$/, '').toUpperCase();

  // 3. Direction.
  const out = OUT_WORDS.exec(work); const inn = IN_WORDS.exec(work);
  if (out && inn) issues.add('AMBIGUOUS_DIRECTION');
  else if (out) result.direction = 'OUT';
  else if (inn) result.direction = 'IN';

  // 4. Amount.
  if (SHILLING.test(work)) issues.add('UNSUPPORTED_CURRENCY');
  const amounts = [...work.matchAll(new RegExp(AMOUNT, 'gi'))].map(m => amountFrom(m[1], m[2]));
  for (const a of amounts) if (a.issue) issues.add(a.issue);
  const distinct = [...new Set(amounts.filter(a => a.milli !== null).map(a => a.milli!.toString()))];
  if (distinct.length === 1) { result.amountMilli = BigInt(distinct[0]); result.currency = 'USD'; }
  else if (distinct.length > 1) issues.add('MULTIPLE_AMOUNTS');
  if (result.amountMilli === 0n) { issues.add('AMOUNT_INVALID'); result.amountMilli = null; }

  // Counterparty, taken from the words right after the direction phrase.
  if (result.direction) {
    const anchor = result.direction === 'OUT' ? out! : inn!;
    const segment = segmentAfter(work, anchor.index + anchor[0].length);
    const cp = counterpartyFrom(segment.replace(new RegExp(AMOUNT, 'gi'), ' '));
    result.counterpartyName = cp.name; result.counterpartyPhone = cp.phone;
    if (cp.phoneUnreadable) issues.add('PHONE_UNREADABLE');
    if (!cp.name && !cp.phone) issues.add('COUNTERPARTY_MISSING');
  }

  // Classify.
  if (result.direction || OTHER_MONEY_WORDS.test(work) || distinct.length > 0) {
    result.kind = 'TRANSACTION';
    if (!result.direction && !issues.has('AMBIGUOUS_DIRECTION')) issues.add('NO_DIRECTION');
    if (result.amountMilli === null && !issues.has('MULTIPLE_AMOUNTS') && !issues.has('AMOUNT_PRECISION') && !issues.has('AMOUNT_INVALID')) issues.add('NO_AMOUNT');
  } else if (result.balanceMilli !== null && !issues.has('NOT_EVC_FORMAT')) {
    result.kind = 'BALANCE';
  }
  result.issues = [...issues].sort();
  result.autoConfirm = result.kind === 'TRANSACTION' && result.direction !== null && result.amountMilli !== null
    && result.currency === 'USD' && !result.issues.some(i => BLOCKING_ISSUES.has(i));
  if (result.kind !== 'TRANSACTION') result.issues = result.issues.filter(i => i !== 'TIME_MISSING');
  return result;
}

/** JSON-safe form (bigints as canonical decimal strings) for storage and the API. */
export interface ParsedSmsJson extends Omit<ParsedSms, 'amountMilli' | 'balanceMilli'> { amount: string | null; balance: string | null }
export function parsedToJson(p: ParsedSms, toDecimal: (m: bigint) => string): ParsedSmsJson {
  const { amountMilli, balanceMilli, ...rest } = p;
  return { ...rest, amount: amountMilli === null ? null : toDecimal(amountMilli), balance: balanceMilli === null ? null : toDecimal(balanceMilli) };
}
