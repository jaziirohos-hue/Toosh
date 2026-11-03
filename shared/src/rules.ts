/**
 * Taught message formats ("Bar Toosh"). A person picks one SMS and says what it is: money in, money out, or not
 * money, plus which number in it is the amount (and optionally the balance, the other person's name and number).
 * From that one example Toosh builds a pattern: the same sender, the same wording, with the amount, balance, name,
 * phone and any other numbers (dates, times, references) left open. Later SMS that fit the pattern are kept by the
 * phone and classified the same way.
 *
 * Patterns use only features that behave the same in JavaScript and Java (escaped text, \s+, \d+, character
 * classes, named groups and one lazy group for a name), because the Android app checks them too (LearnedRules.java).
 */
import { parseAmount, toDecimalString } from './money.ts';
import { parseEvcSms, type ParseOptions, type ParsedSms } from './parser.ts';
import { phoneFromSms } from './phone.ts';
import { normalizeSender } from './relevance.ts';

export type RuleDirection = 'IN' | 'OUT' | 'NONE';
export interface LearnedRule { id: string; sender: string; pattern: string; direction: RuleDirection }

export interface TeachInput {
  body: string;
  direction: RuleDirection;
  /** The amount exactly as a number in the SMS ("0.15", "1,250"); required for IN/OUT. */
  amount?: string | null;
  balance?: string | null;
  counterpartyName?: string | null;
}

/** Whitespace collapsed, ends trimmed: the form both builders and matchers work on. */
export const normalizeBody = (body: string) => String(body ?? '').replace(/\s+/g, ' ').trim();

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const valueOf = (s: string) => { const r = parseAmount(s.replace(/,/g, ''), { allowZero: true }); return r.ok ? r.milli : null; };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/\-]/g, m => '\\' + m);

/** Every number in the SMS with its position and value, for the "which is the amount?" choice. */
export function numbersIn(body: string): { text: string; index: number; value: string | null }[] {
  const text = normalizeBody(body);
  return [...text.matchAll(NUMBER)].map(m => ({ text: m[0], index: m.index!, value: (v => (v === null ? null : toDecimalString(v)))(valueOf(m[0])) }));
}

/** A suggested name: the words right before "(phone)" such as "SADAAM XUSEEN CALI(612729106)". */
export function suggestName(body: string): string | null {
  const m = /([A-Za-z][A-Za-z'.]*(?:\s+[A-Za-z][A-Za-z'.]*){0,5})\s*\(\s*\+?\d{7,15}\s*\)/.exec(normalizeBody(body));
  if (!m) return null;
  // Drop leading lower-case words (the verb), keep the name: "u dirtay SADAAM XUSEEN CALI" -> "SADAAM XUSEEN CALI".
  const words = m[1].split(/\s+/);
  while (words.length > 1 && words[0] === words[0].toLowerCase()) words.shift();
  return words.join(' ');
}

type Span = { start: number; end: number; group: 'amount' | 'balance' | 'name' | 'phone' };

/**
 * Builds a pattern from one example. Returns an error code when the example cannot be used
 * (AMOUNT_NOT_FOUND, BALANCE_NOT_FOUND, NAME_NOT_FOUND, AMOUNT_REQUIRED).
 */
export function buildRulePattern(input: TeachInput): { ok: true; pattern: string } | { ok: false; error: string } {
  const text = normalizeBody(input.body);
  if (!text) return { ok: false, error: 'EMPTY' };
  const nums = [...text.matchAll(NUMBER)].map(m => ({ start: m.index!, end: m.index! + m[0].length, value: valueOf(m[0]) }));
  const spans: Span[] = [];
  const taken = (s: number, e: number) => spans.some(x => s < x.end && x.start < e);
  if (input.direction !== 'NONE') {
    const want = input.amount ? valueOf(input.amount) : null;
    if (want === null) return { ok: false, error: 'AMOUNT_REQUIRED' };
    const n = nums.find(x => x.value === want && x.end - x.start <= 20);
    if (!n) return { ok: false, error: 'AMOUNT_NOT_FOUND' };
    spans.push({ start: n.start, end: n.end, group: 'amount' });
  }
  if (input.balance) {
    const want = valueOf(input.balance);
    const n = [...nums].reverse().find(x => x.value === want && !taken(x.start, x.end));
    if (!n) return { ok: false, error: 'BALANCE_NOT_FOUND' };
    spans.push({ start: n.start, end: n.end, group: 'balance' });
  }
  if (input.counterpartyName?.trim()) {
    const name = normalizeBody(input.counterpartyName);
    const at = text.toLowerCase().indexOf(name.toLowerCase());
    if (at < 0 || taken(at, at + name.length)) return { ok: false, error: 'NAME_NOT_FOUND' };
    spans.push({ start: at, end: at + name.length, group: 'name' });
  }
  // The other person's number: the first 7-15 digit run in brackets, when present.
  const phone = /\(\s*(\+?\d{7,15})\s*\)/.exec(text);
  if (phone) { const s = phone.index + phone[0].indexOf(phone[1]); if (!taken(s, s + phone[1].length)) spans.push({ start: s, end: s + phone[1].length, group: 'phone' }); }
  spans.sort((a, b) => a.start - b.start);

  const GROUP: Record<Span['group'], string> = {
    amount: '(?<amount>\\d[\\d,]*(?:\\.\\d+)?)', balance: '(?<balance>\\d[\\d,]*(?:\\.\\d+)?)',
    name: '(?<name>.+?)', phone: '(?<phone>\\+?\\d{7,15})',
  };
  let out = ''; let i = 0;
  const literal = (s: string) => s.split(/(\s+|\d+)/).filter(Boolean).map(p => (/^\s+$/.test(p) ? '\\s+' : /^\d+$/.test(p) ? '\\d+' : escape(p))).join('');
  for (const sp of spans) { out += literal(text.slice(i, sp.start)) + GROUP[sp.group]; i = sp.end; }
  out += literal(text.slice(i));
  return { ok: true, pattern: `^${out}$` };
}

const compiled = new Map<string, RegExp>();
function regex(pattern: string): RegExp | null {
  let r = compiled.get(pattern);
  if (r === undefined) {
    try { r = new RegExp(pattern, 'i'); } catch { r = null as unknown as RegExp; }
    compiled.set(pattern, r);
  }
  return r;
}

/** The first taught rule for this sender whose pattern fits the whole SMS. */
export function matchRule(rules: readonly LearnedRule[], sender: string, body: string): { rule: LearnedRule; groups: Record<string, string | undefined> } | null {
  const s = normalizeSender(sender);
  const text = normalizeBody(body);
  if (text.length > 2000) return null;
  for (const rule of rules) {
    if (normalizeSender(rule.sender) !== s) continue;
    const m = regex(rule.pattern)?.exec(text);
    if (m) return { rule, groups: { ...(m.groups ?? {}) } };
  }
  return null;
}

/**
 * The built-in parser first; when it cannot confirm the SMS, a taught rule may. A rule result is confirmed
 * automatically (marked by parserVersion "rule:<id>"), and can still be corrected by hand like any other.
 */
export function parseWithRules(body: string, sender: string, rules: readonly LearnedRule[], options: ParseOptions = {}): ParsedSms {
  const parsed = parseEvcSms(body, options);
  if (parsed.autoConfirm || !rules.length) return parsed;
  const hit = matchRule(rules, sender, body);
  if (!hit) return parsed;
  const g = hit.groups;
  const balance = g.balance ? valueOf(g.balance) : parsed.balanceMilli;
  const base: ParsedSms = { ...parsed, parserVersion: `rule:${hit.rule.id}`, balanceMilli: balance, issues: [] };
  if (hit.rule.direction === 'NONE') return { ...base, kind: 'BALANCE', direction: null, amountMilli: null, currency: null, autoConfirm: false };
  const amount = g.amount ? valueOf(g.amount) : null;
  if (amount === null || amount <= 0n) return parsed;
  return {
    ...base, kind: 'TRANSACTION', direction: hit.rule.direction, amountMilli: amount, currency: 'USD',
    counterpartyName: g.name?.trim() || parsed.counterpartyName, counterpartyPhone: g.phone ? phoneFromSms(g.phone) : parsed.counterpartyPhone,
    autoConfirm: true,
  };
}
