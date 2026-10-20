/**
 * Fixed-point money. Every amount is an integer count of thousandths of a currency unit ("milli"),
 * held as a bigint. EVC Plus reports values such as $54.585, so three decimal places are kept exactly.
 * No binary floating point is used for money anywhere in Toosh.
 */
export const MONEY_SCALE = 3;
export const SUPPORTED_CURRENCIES = ['USD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
/** Largest accepted amount: 999,999,999.999 */
export const MAX_MILLI = 999_999_999_999n;

export type AmountResult = { ok: true; milli: bigint } | { ok: false; error: AmountError };
export type AmountError = 'EMPTY' | 'FORMAT' | 'PRECISION' | 'TOO_LARGE' | 'NOT_POSITIVE';

/**
 * Parses a user or SMS decimal string ("3", "3.9", "1,250.50", "54.585") into milli units.
 * Rejects more than three decimal places instead of rounding.
 */
export function parseAmount(input: string, opts: { allowZero?: boolean } = {}): AmountResult {
  const text = String(input ?? '').trim().replace(/^\$\s*/, '');
  if (!text) return { ok: false, error: 'EMPTY' };
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return { ok: false, error: 'FORMAT' };
  const whole = m[1].replace(/,/g, '');
  const fraction = m[2] ?? '';
  if (fraction.length > MONEY_SCALE) return { ok: false, error: 'PRECISION' };
  const milli = BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  if (milli > MAX_MILLI) return { ok: false, error: 'TOO_LARGE' };
  if (milli <= 0n && !(opts.allowZero && milli === 0n)) return { ok: false, error: 'NOT_POSITIVE' };
  return { ok: true, milli };
}

/** Canonical decimal string used on the wire and in the UI: at least two decimals, a third only when it is not zero
 *  (3900 -> "3.90", 54585 -> "54.585"). Lossless: parseAmount(toDecimalString(x)) === x. */
export function toDecimalString(milli: bigint): string {
  const negative = milli < 0n;
  const abs = negative ? -milli : milli;
  const whole = abs / 1000n;
  let fraction = (abs % 1000n).toString().padStart(3, '0');
  if (fraction.endsWith('0')) fraction = fraction.slice(0, 2);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** "$54.585", "$51.59", "$3.00", "$1,250.50"; optional explicit sign for incoming/outgoing. */
export function formatMoney(milli: bigint, opts: { sign?: '+' | '-' | 'auto' | 'none' } = {}): string {
  const negative = milli < 0n;
  const abs = negative ? -milli : milli;
  const [whole, fraction] = toDecimalString(abs).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = opts.sign === '+' ? '+' : opts.sign === '-' ? '-' : opts.sign === 'auto' ? (negative ? '-' : '') : negative ? '-' : '';
  return `${sign}$${grouped}.${fraction}`;
}

export function sumMilli(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Parses a canonical wire value ("54.585") into milli; throws on anything else. */
export function milliFromWire(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  const r = parseAmount(value, { allowZero: true });
  if (!r.ok) throw new Error(`Invalid money value: ${r.error}`);
  return r.milli;
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
