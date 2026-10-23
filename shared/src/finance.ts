/**
 * Expenses, categories, budgets and savings goals: the rules shared by the server and the app.
 * Amounts are integer thousandths (bigint on the server, decimal strings on the wire), as for EVC Plus amounts.
 */
import { formatMoney, parseAmount, toDecimalString } from './money.ts';

export const FINANCE_CURRENCIES = ['USD', 'SOS'] as const;
export type FinanceCurrency = (typeof FINANCE_CURRENCIES)[number];
export const isFinanceCurrency = (v: unknown): v is FinanceCurrency => FINANCE_CURRENCIES.includes(v as FinanceCurrency);

export interface BuiltinCategory { key: string; so: string; en: string; icon: string }
/** Built-in expense categories, in display order. 'biil' (Bills) replaces the old idea of "Guriga". */
export const BUILTIN_CATEGORIES: readonly BuiltinCategory[] = [
  { key: 'biil', so: 'Biil', en: 'Bills', icon: 'receipt_long' },
  { key: 'korantada', so: 'Korantada', en: 'Electricity', icon: 'bolt' },
  { key: 'iskuulka', so: 'Iskuulka', en: 'School fees', icon: 'school' },
  { key: 'dugsiga', so: 'Dugsiga', en: 'Quranic school', icon: 'menu_book' },
  { key: 'gaari_raac', so: 'Gaari Raac', en: 'Transportation', icon: 'directions_bus' },
  { key: 'kirada', so: 'Kirada', en: 'Rent', icon: 'home' },
  { key: 'biyaha', so: 'Biyaha', en: 'Water', icon: 'water_drop' },
  { key: 'cuntada', so: 'Cuntada', en: 'Food', icon: 'restaurant' },
  { key: 'internet', so: 'Internet', en: 'Internet', icon: 'wifi' },
  { key: 'caafimaadka', so: 'Caafimaadka', en: 'Healthcare', icon: 'medical_services' },
  { key: 'kale', so: 'Qarashaad Kale', en: 'Other expenses', icon: 'more_horiz' },
];
export const BUILTIN_KEYS: ReadonlySet<string> = new Set(BUILTIN_CATEGORIES.map(c => c.key));
/** Icons a person may choose for a category they create. */
export const CUSTOM_CATEGORY_ICONS = ['sell', 'shopping_cart', 'checkroom', 'local_gas_station', 'phone_iphone', 'family_restroom', 'celebration',
  'volunteer_activism', 'mosque', 'construction', 'pets', 'flight', 'sports_soccer', 'local_cafe', 'savings', 'work'] as const;

/** A category on the wire: a built-in key ("korantada") or "custom:<uuid>". */
export type CategoryRef = { kind: 'builtin'; key: string } | { kind: 'custom'; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseCategoryRef(v: unknown): CategoryRef | null {
  if (typeof v !== 'string') return null;
  if (BUILTIN_KEYS.has(v)) return { kind: 'builtin', key: v };
  const m = /^custom:(.+)$/.exec(v);
  return m && UUID.test(m[1]) ? { kind: 'custom', id: m[1].toLowerCase() } : null;
}
export const categoryRefString = (key: string | null, customId: string | null): string | null =>
  key ? key : customId ? `custom:${customId}` : null;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const AMOUNT_ERRORS: Record<string, string> = {
  EMPTY: 'Geli qaddarka.', FORMAT: 'Qaddarku waa inuu noqdaa tiro sida 15.00.', PRECISION: 'Ugu badnaan 3 jajab.',
  TOO_LARGE: 'Qaddarku aad buu u weyn yahay.', NOT_POSITIVE: 'Qaddarku waa inuu ka weyn yahay 0.',
};
const cleanText = (v: unknown, max: number): string | null =>
  (typeof v === 'string' && v.trim() && v.trim().length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v) ? v.trim() : null);

function amountField(v: unknown, errors: Record<string, string>, key = 'amount', allowZero = false): bigint | null {
  const r = parseAmount(typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '', { allowZero });
  if (!r.ok) { errors[key] = AMOUNT_ERRORS[r.error]; return null; }
  return r.milli;
}

export interface ExpenseInput { name: string; amountMilli: bigint; currency: FinanceCurrency; category: CategoryRef; spentOn: string; description: string | null; paymentStatus: 'PAID' | 'UNPAID' }
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** Validates a full expense (create, or edit sending every field). `today` bounds the date to the account's today. */
export function validateExpense(input: any, today: string): Validation<ExpenseInput> {
  const errors: Record<string, string> = {};
  const b = input && typeof input === 'object' ? input : {};
  const name = cleanText(b.name, 120);
  if (!name) errors.name = 'Geli magaca qarashka (ilaa 120 xaraf).';
  const amountMilli = amountField(b.amount, errors);
  if (!isFinanceCurrency(b.currency)) errors.currency = 'Dooro lacagta: USD ama SOS.';
  const category = parseCategoryRef(b.category);
  if (!category) errors.category = 'Dooro qaybta qarashka.';
  if (!isIsoDate(b.spentOn)) errors.spentOn = 'Geli taariikh sax ah.';
  else if (b.spentOn > today) errors.spentOn = 'Taariikhdu ma noqon karto mustaqbalka.';
  else if (b.spentOn < '2000-01-01') errors.spentOn = 'Taariikh aad u fog.';
  let description: string | null = null;
  if (b.description !== undefined && b.description !== null && b.description !== '') {
    description = cleanText(b.description, 500);
    if (!description) errors.description = 'Faahfaahintu waa ugu badnaan 500 xaraf.';
  }
  if (b.paymentStatus !== 'PAID' && b.paymentStatus !== 'UNPAID') errors.paymentStatus = 'Dooro: la bixiyay ama lama bixin.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name: name!, amountMilli: amountMilli!, currency: b.currency, category: category!, spentOn: b.spentOn, description, paymentStatus: b.paymentStatus } };
}

export const BUDGET_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];
export interface BudgetInput { period: BudgetPeriod; category: CategoryRef | null; amountMilli: bigint; currency: FinanceCurrency; alertPercent: number }
export function validateBudget(input: any): Validation<BudgetInput> {
  const errors: Record<string, string> = {};
  const b = input && typeof input === 'object' ? input : {};
  if (!BUDGET_PERIODS.includes(b.period)) errors.period = 'Dooro muddada: maalin, toddobaad ama bil.';
  const category = b.category === null || b.category === undefined || b.category === '' ? null : parseCategoryRef(b.category);
  if (b.category && !category) errors.category = 'Qayb aan sax ahayn.';
  const amountMilli = amountField(b.amount, errors);
  if (!isFinanceCurrency(b.currency)) errors.currency = 'Dooro lacagta: USD ama SOS.';
  const alertPercent = b.alertPercent === undefined ? 80 : b.alertPercent;
  if (!Number.isInteger(alertPercent) || alertPercent < 1 || alertPercent > 100) errors.alertPercent = 'Digniinta waa 1-100%.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { period: b.period, category, amountMilli: amountMilli!, currency: b.currency, alertPercent } };
}

export interface GoalInput { name: string; targetMilli: bigint; savedMilli: bigint; currency: FinanceCurrency; targetDate: string | null }
export function validateGoal(input: any): Validation<GoalInput> {
  const errors: Record<string, string> = {};
  const b = input && typeof input === 'object' ? input : {};
  const name = cleanText(b.name, 80);
  if (!name) errors.name = 'Geli magaca hadafka (ilaa 80 xaraf).';
  const targetMilli = amountField(b.target, errors, 'target');
  const savedMilli = b.saved === undefined || b.saved === null || b.saved === '' ? 0n : amountField(b.saved, errors, 'saved', true);
  if (!isFinanceCurrency(b.currency)) errors.currency = 'Dooro lacagta: USD ama SOS.';
  let targetDate: string | null = null;
  if (b.targetDate) { if (isIsoDate(b.targetDate)) targetDate = b.targetDate; else errors.targetDate = 'Taariikh aan sax ahayn.'; }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name: name!, targetMilli: targetMilli!, savedMilli: savedMilli!, currency: b.currency, targetDate } };
}

/** Display: "$12.50" for USD (same as EVC amounts), "SOS 12,500" for Somali shillings. */
export function formatCurrency(milli: bigint, currency: FinanceCurrency, sign: '' | '+' | '-' = ''): string {
  if (currency === 'USD') return formatMoney(milli, { sign: sign || 'auto' });
  const neg = milli < 0n;
  const [whole, frac] = toDecimalString(neg ? -milli : milli).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const f = frac.replace(/0+$/, '');
  return `${sign || (neg ? '-' : '')}SOS ${grouped}${f ? '.' + f : ''}`;
}
