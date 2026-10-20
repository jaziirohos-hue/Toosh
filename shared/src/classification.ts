/**
 * Manual classification rules. The same function validates the form in the app and the request on the server, so
 * both sides accept and reject exactly the same values.
 */
import { isCurrency, parseAmount, type Currency } from './money.ts';
import { normalizeSomaliMsisdn } from './phone.ts';
import { isIsoInstant } from './time.ts';
import type { Direction } from './parser.ts';

export type Classification = 'PENDING' | 'TRANSACTION' | 'NOT_TRANSACTION';
export type FieldSource = 'PARSER' | 'MANUAL' | 'RECEIPT_FALLBACK';

export interface ClassificationRequest {
  classification: 'TRANSACTION' | 'NOT_TRANSACTION';
  expectedVersion: number;
  direction?: Direction;
  amount?: string;
  currency?: string;
  /** ISO instant. null/omitted = no time in the SMS: the SMS receipt time is used and recorded as a fallback. */
  occurredAt?: string | null;
  counterpartyName?: string | null;
  counterpartyPhone?: string | null;
  balance?: string | null;
  note?: string | null;
}

export interface ValidClassification {
  classification: 'TRANSACTION' | 'NOT_TRANSACTION';
  expectedVersion: number;
  direction: Direction | null;
  amountMilli: bigint | null;
  currency: Currency | null;
  occurredAt: string | null;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
  balanceMilli: bigint | null;
  note: string | null;
}

export type ValidationResult = { ok: true; value: ValidClassification } | { ok: false; errors: Record<string, string> };

const AMOUNT_MESSAGES: Record<string, string> = {
  EMPTY: 'Geli qaddarka lacagta.', FORMAT: 'Qaddarku waa inuu noqdaa tiro sida 15.00.',
  PRECISION: 'Ugu badnaan 3 jajab (sida 54.585).', TOO_LARGE: 'Qaddarku aad buu u weyn yahay.', NOT_POSITIVE: 'Qaddarku waa inuu ka weyn yahay 0.',
};

export function validateClassification(input: unknown, now: Date = new Date()): ValidationResult {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const classification = body.classification;
  if (classification !== 'TRANSACTION' && classification !== 'NOT_TRANSACTION') errors.classification = 'Dooro nooca fariinta.';
  const expectedVersion = body.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) errors.expectedVersion = 'Nooca kaydka (version) waa khalad.';
  const text = (key: string, max: number): string | null => {
    const v = body[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) { errors[key] = 'Qoraal aan sax ahayn.'; return null; }
    return v.trim() || null;
  };
  const note = text('note', 500);
  const value: ValidClassification = {
    classification: classification as ValidClassification['classification'], expectedVersion: expectedVersion as number,
    direction: null, amountMilli: null, currency: null, occurredAt: null, counterpartyName: null, counterpartyPhone: null, balanceMilli: null, note,
  };
  if (classification === 'TRANSACTION') {
    if (body.direction !== 'IN' && body.direction !== 'OUT') errors.direction = 'Dooro Soo galay ama Baxay.';
    else value.direction = body.direction;
    const amount = parseAmount(typeof body.amount === 'string' ? body.amount : '');
    if (!amount.ok) errors.amount = AMOUNT_MESSAGES[amount.error]; else value.amountMilli = amount.milli;
    const currency = body.currency ?? 'USD';
    if (!isCurrency(currency)) errors.currency = 'Lacagta USD oo keliya ayaa la taageeraa.'; else value.currency = currency;
    if (body.occurredAt !== undefined && body.occurredAt !== null) {
      if (!isIsoInstant(body.occurredAt)) errors.occurredAt = 'Taariikh iyo waqti sax ah geli.';
      else {
        const t = new Date(body.occurredAt as string);
        if (t.getTime() > now.getTime() + 5 * 60000 || t.getUTCFullYear() < 2000) errors.occurredAt = 'Waqtigu ma noqon karo mustaqbalka.';
        else value.occurredAt = t.toISOString();
      }
    }
    value.counterpartyName = text('counterpartyName', 120);
    const phone = text('counterpartyPhone', 32);
    if (phone) {
      const p = normalizeSomaliMsisdn(phone);
      if (!p.ok) errors.counterpartyPhone = 'Lambar Soomaali ah oo sax ah geli (sida 61 599 8822).'; else value.counterpartyPhone = p.e164;
    }
    if (body.balance !== undefined && body.balance !== null && body.balance !== '') {
      const b = parseAmount(String(body.balance), { allowZero: true });
      if (!b.ok) errors.balance = AMOUNT_MESSAGES[b.error]; else value.balanceMilli = b.milli;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
