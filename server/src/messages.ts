import { createHash, randomUUID } from 'node:crypto';
import {
  isIsoInstant, isRelevantEvcMessage, normalizeSender, parseEvcSms, parsedToJson, toDecimalString, validateClassification,
  type ParsedSms,
} from '@toosh/shared';
import { isUniqueViolation, type Tx } from './db.ts';
import { notifyAccount } from './events.ts';

/** EVC Plus writes times in Somalia local time, whatever the account timezone is. */
export const EVC_TIMEZONE = 'Africa/Mogadishu';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export interface Actor { accountId: string; deviceId: string; deviceName: string }

// ---------------------------------------------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------------------------------------------
const money = (v: string | null) => (v === null || v === undefined ? null : toDecimalString(BigInt(v)));
const iso = (v: Date | string | null) => (v === null || v === undefined ? null : new Date(v).toISOString());

export function serializeMessage(r: any) {
  return {
    id: r.id, evcNumberId: r.evc_number_id, sourceDeviceId: r.source_device_id,
    sender: r.sender, body: r.body,
    smsTimestamp: iso(r.sms_timestamp), receivedAt: iso(r.received_at), uploadedAt: iso(r.uploaded_at),
    simSubscriptionId: r.sim_subscription_id, simSlot: r.sim_slot, importMethod: r.import_method, partsCount: r.parts_count,
    parserVersion: r.parser_version, parsed: r.parsed,
    classification: r.classification, classificationSource: r.classification_source,
    transaction: r.classification === 'TRANSACTION' ? {
      direction: r.direction, amount: money(r.amount_milli), currency: r.currency,
      occurredAt: iso(r.occurred_at), occurredAtSource: r.occurred_at_source,
      counterpartyName: r.counterparty_name, counterpartyPhone: r.counterparty_phone, providerRef: r.provider_ref,
    } : null,
    balance: r.balance_milli === null ? null : {
      amount: money(r.balance_milli), source: r.balance_source, effectiveAt: iso(r.balance_effective_at),
      eligible: r.classification !== 'PENDING',
    },
    fieldSources: r.field_sources ?? {},
    version: r.version, updatedAt: iso(r.updated_at), updatedByDeviceId: r.updated_by_device_id, changeSeq: String(r.change_seq),
  };
}
export type MessageDto = ReturnType<typeof serializeMessage>;

/** The user-visible state of a message, recorded in the audit log as "previous"/"next". */
function snapshot(r: any) {
  return {
    classification: r.classification, classificationSource: r.classification_source, direction: r.direction ?? null,
    amount: money(r.amount_milli ?? null), currency: r.currency ?? null, occurredAt: iso(r.occurred_at ?? null),
    occurredAtSource: r.occurred_at_source ?? null, counterpartyName: r.counterparty_name ?? null,
    counterpartyPhone: r.counterparty_phone ?? null, providerRef: r.provider_ref ?? null,
    balance: money(r.balance_milli ?? null), balanceSource: r.balance_source ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Parser -> stored fields
// ---------------------------------------------------------------------------------------------------------------
interface Effective {
  classification: 'PENDING' | 'TRANSACTION' | 'NOT_TRANSACTION';
  direction: string | null; amount_milli: string | null; currency: string | null;
  occurred_at: string | null; occurred_at_source: string | null;
  counterparty_name: string | null; counterparty_phone: string | null; provider_ref: string | null;
  balance_milli: string | null; balance_source: string | null; field_sources: Record<string, string>;
}

export function effectiveFromParse(p: ParsedSms, receivedAt: string): Effective {
  const balance = p.balanceMilli === null ? null : p.balanceMilli.toString();
  const base: Effective = {
    classification: 'PENDING', direction: null, amount_milli: null, currency: null, occurred_at: null, occurred_at_source: null,
    counterparty_name: null, counterparty_phone: null, provider_ref: p.providerRef, balance_milli: balance,
    balance_source: balance === null ? null : 'PARSER', field_sources: {},
  };
  if (p.kind === 'TRANSACTION' && p.autoConfirm) {
    return {
      ...base, classification: 'TRANSACTION', direction: p.direction, amount_milli: p.amountMilli!.toString(), currency: p.currency,
      occurred_at: p.occurredAt ?? receivedAt, occurred_at_source: p.occurredAt ? 'SMS' : 'RECEIPT_FALLBACK',
      counterparty_name: p.counterpartyName, counterparty_phone: p.counterpartyPhone,
      field_sources: { direction: 'PARSER', amount: 'PARSER', occurredAt: p.occurredAt ? 'PARSER' : 'RECEIPT_FALLBACK', counterpartyName: 'PARSER', counterpartyPhone: 'PARSER', balance: 'PARSER' },
    };
  }
  if (p.kind === 'BALANCE') return { ...base, classification: 'NOT_TRANSACTION', provider_ref: null, field_sources: { balance: 'PARSER' } };
  return base;
}

const parsedJson = (p: ParsedSms, reviewReasons: string[] = []) => ({ ...parsedToJson(p, toDecimalString), reviewReasons });

// ---------------------------------------------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------------------------------------------
export interface IngestItem {
  clientMessageId: string; evcNumberId: string; sender: string; body: string; smsTimestamp: string; receivedAt: string;
  simSubscriptionId: number | null; simSlot: number | null; importMethod: 'LIVE' | 'INITIAL_IMPORT' | 'RECOVERY'; partsCount: number;
}
export type IngestResult =
  | { clientMessageId: string; status: 'created' | 'duplicate'; messageId: string; classification: string }
  | { clientMessageId: string; status: 'rejected'; code: string; retryable: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateIngestItem(raw: any, now = new Date()): { ok: true; item: IngestItem } | { ok: false; code: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'INVALID' };
  const id = raw.clientMessageId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(id)) return { ok: false, code: 'INVALID_CLIENT_ID' };
  if (typeof raw.evcNumberId !== 'string' || !UUID.test(raw.evcNumberId)) return { ok: false, code: 'INVALID_NUMBER' };
  if (typeof raw.sender !== 'string' || !raw.sender.trim() || raw.sender.length > 64) return { ok: false, code: 'INVALID_SENDER' };
  if (typeof raw.body !== 'string' || !raw.body.trim() || raw.body.length > 5000) return { ok: false, code: 'INVALID_BODY' };
  for (const key of ['smsTimestamp', 'receivedAt']) {
    if (!isIsoInstant(raw[key])) return { ok: false, code: 'INVALID_TIME' };
    const t = Date.parse(raw[key]);
    if (t > now.getTime() + 24 * 3600000 || t < Date.UTC(2010, 0, 1)) return { ok: false, code: 'INVALID_TIME' };
  }
  const int = (v: unknown) => v === null || v === undefined ? null : Number.isSafeInteger(v) ? (v as number) : NaN;
  const sub = int(raw.simSubscriptionId); const slot = int(raw.simSlot);
  if (Number.isNaN(sub) || Number.isNaN(slot) || (slot !== null && (slot < 0 || slot > 7))) return { ok: false, code: 'INVALID_SIM' };
  const method = raw.importMethod ?? 'LIVE';
  if (!['LIVE', 'INITIAL_IMPORT', 'RECOVERY'].includes(method)) return { ok: false, code: 'INVALID_IMPORT_METHOD' };
  const parts = raw.partsCount ?? 1;
  if (!Number.isSafeInteger(parts) || parts < 1 || parts > 30) return { ok: false, code: 'INVALID_PARTS' };
  if (!isRelevantEvcMessage(raw.sender, raw.body, false)) return { ok: false, code: 'NOT_EVC_MESSAGE' };
  return { ok: true, item: {
    clientMessageId: id, evcNumberId: raw.evcNumberId.toLowerCase(), sender: raw.sender.trim(), body: raw.body,
    smsTimestamp: new Date(raw.smsTimestamp).toISOString(), receivedAt: new Date(raw.receivedAt).toISOString(),
    simSubscriptionId: sub, simSlot: slot, importMethod: method, partsCount: parts,
  } };
}

/**
 * Content identity of an SMS for one registered number: the network timestamp (milliseconds), sender and exact text.
 * Live delivery, the initial inbox import and retries of the same SMS all produce the same key. Two separate real
 * payments always differ in network timestamp, so equal amounts at equal times are NOT merged by this key.
 */
export function dedupeKey(item: Pick<IngestItem, 'evcNumberId' | 'sender' | 'smsTimestamp' | 'body'>): string {
  return createHash('sha256').update([item.evcNumberId, normalizeSender(item.sender), String(Date.parse(item.smsTimestamp)), item.body].join('\n')).digest('hex');
}

const INSERT_SQL = `
  INSERT INTO messages (id, account_id, evc_number_id, source_device_id, client_message_id, dedupe_key, sender, body,
    sms_timestamp, received_at, sim_subscription_id, sim_slot, import_method, parts_count, parser_version, parsed,
    classification, classification_source, direction, amount_milli, currency, occurred_at, occurred_at_source,
    counterparty_name, counterparty_phone, provider_ref, balance_milli, balance_source, field_sources)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PARSER',$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
  ON CONFLICT (account_id, dedupe_key) DO NOTHING
  RETURNING *`;

export async function ingestBatch(tx: Tx, actor: Actor, rawItems: unknown[], now = new Date()): Promise<IngestResult[]> {
  const { rows: numbers } = await tx.query(
    'SELECT id, sim_subscription_id FROM evc_numbers WHERE account_id = $1 AND source_device_id = $2', [actor.accountId, actor.deviceId]);
  const owned = new Map(numbers.map(n => [n.id as string, n]));
  const results: IngestResult[] = [];
  let changed = false;
  for (const raw of rawItems) {
    const clientMessageId = typeof (raw as any)?.clientMessageId === 'string' ? (raw as any).clientMessageId.slice(0, 128) : '';
    const v = validateIngestItem(raw, now);
    if (!v.ok) { results.push({ clientMessageId, status: 'rejected', code: v.code, retryable: false }); continue; }
    const item = v.item;
    const number = owned.get(item.evcNumberId);
    if (!number) { results.push({ clientMessageId, status: 'rejected', code: 'NOT_SOURCE_FOR_NUMBER', retryable: false }); continue; }
    if (number.sim_subscription_id !== null && item.simSubscriptionId !== null && number.sim_subscription_id !== item.simSubscriptionId) {
      results.push({ clientMessageId, status: 'rejected', code: 'SIM_MISMATCH', retryable: false }); continue;
    }
    const key = dedupeKey(item);
    const parsed = parseEvcSms(item.body, { timeZone: EVC_TIMEZONE, receivedAt: new Date(item.receivedAt) });
    let eff = effectiveFromParse(parsed, item.receivedAt);
    let reasons: string[] = [];
    const id = randomUUID();
    let inserted: any = null;
    for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
      await tx.query('SAVEPOINT ingest_item');
      try {
        const { rows } = await tx.query(INSERT_SQL, [id, actor.accountId, item.evcNumberId, actor.deviceId, item.clientMessageId, key,
          item.sender, item.body, item.smsTimestamp, item.receivedAt, item.simSubscriptionId, item.simSlot, item.importMethod, item.partsCount,
          parsed.parserVersion, JSON.stringify(parsedJson(parsed, reasons)), eff.classification, eff.direction, eff.amount_milli, eff.currency,
          eff.occurred_at, eff.occurred_at_source, eff.counterparty_name, eff.counterparty_phone, eff.provider_ref, eff.balance_milli,
          eff.balance_source, JSON.stringify(eff.field_sources)]);
        await tx.query('RELEASE SAVEPOINT ingest_item');
        inserted = rows[0] ?? false;
        break;
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT ingest_item');
        // The phone reused an import id: answered below as duplicate (same content) or CLIENT_ID_REUSED.
        if (isUniqueViolation(e, 'messages_source_device_id_client_message_id_key')) { inserted = false; break; }
        // Same provider reference already confirmed: never a second transaction; a person decides.
        if (isUniqueViolation(e, 'messages_provider_ref') && attempt === 0) {
          reasons = ['DUPLICATE_REFERENCE'];
          eff = { ...effectiveFromParse({ ...parsed, autoConfirm: false }, item.receivedAt), provider_ref: parsed.providerRef };
          continue;
        }
        throw e;
      }
    }
    if (inserted) {
      await tx.query(`INSERT INTO message_changes (account_id, message_id, action, actor_device_id, actor_device_name, from_version, to_version, previous, next)
        VALUES ($1,$2,'INGEST',$3,$4,NULL,1,NULL,$5)`, [actor.accountId, inserted.id, actor.deviceId, actor.deviceName, JSON.stringify(snapshot(inserted))]);
      results.push({ clientMessageId, status: 'created', messageId: inserted.id, classification: inserted.classification });
      changed = true;
      continue;
    }
    const { rows: existing } = await tx.query(
      `SELECT id, classification, dedupe_key, source_device_id, client_message_id FROM messages
        WHERE account_id = $1 AND (dedupe_key = $2 OR (source_device_id = $3 AND client_message_id = $4))`,
      [actor.accountId, key, actor.deviceId, item.clientMessageId]);
    const same = existing.find(r => r.dedupe_key === key);
    if (same) results.push({ clientMessageId, status: 'duplicate', messageId: same.id, classification: same.classification });
    else results.push({ clientMessageId, status: 'rejected', code: 'CLIENT_ID_REUSED', retryable: false });
  }
  await tx.query('UPDATE devices SET last_upload_at = $2 WHERE id = $1', [actor.deviceId, now.toISOString()]);
  if (changed) await notifyAccount(tx, actor.accountId);
  return results;
}

// ---------------------------------------------------------------------------------------------------------------
// Manual classification
// ---------------------------------------------------------------------------------------------------------------
export async function classifyMessage(tx: Tx, actor: Actor, id: string, input: unknown, now = new Date()) {
  if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Fariinta lama helin.');
  const v = validateClassification(input, now);
  if (!v.ok) throw new ApiError(400, 'VALIDATION', 'Hubi xogta foomka.', v.errors);
  const req = v.value;
  const { rows } = await tx.query('SELECT * FROM messages WHERE account_id = $1 AND id = $2 FOR UPDATE', [actor.accountId, id]);
  const current = rows[0];
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Fariinta lama helin.');
  if (current.version !== req.expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Fariintan waxaa beddelay aalad kale. Eeg isbeddelka ka hor intaadan kaydin.', { current: serializeMessage(current) });
  }
  const parsed = current.parsed ?? {};
  const sameAs = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  let next: Effective;
  if (req.classification === 'NOT_TRANSACTION') {
    next = {
      classification: 'NOT_TRANSACTION', direction: null, amount_milli: null, currency: null, occurred_at: null, occurred_at_source: null,
      counterparty_name: null, counterparty_phone: null, provider_ref: null,
      balance_milli: current.balance_milli, balance_source: current.balance_source, field_sources: current.balance_milli !== null ? { balance: current.balance_source } : {},
    };
  } else {
    const smsTime: string | null = parsed.occurredAt ?? null;
    let occurredAt: string; let occurredSource: string;
    if (req.occurredAt) { occurredAt = req.occurredAt; occurredSource = smsTime && Date.parse(smsTime) === Date.parse(req.occurredAt) ? 'SMS' : 'MANUAL'; }
    else if (smsTime) { occurredAt = smsTime; occurredSource = 'SMS'; }
    else { occurredAt = new Date(current.received_at).toISOString(); occurredSource = 'RECEIPT_FALLBACK'; }
    const amount = req.amountMilli!.toString(); const balance = req.balanceMilli === null ? null : req.balanceMilli.toString();
    const src = (equal: boolean) => (equal ? 'PARSER' : 'MANUAL');
    const parsedMilli = (v: string | null) => (v ? toMilliString(v) : null);
    next = {
      classification: 'TRANSACTION', direction: req.direction, amount_milli: amount, currency: req.currency,
      occurred_at: occurredAt, occurred_at_source: occurredSource,
      counterparty_name: req.counterpartyName, counterparty_phone: req.counterpartyPhone, provider_ref: current.provider_ref ?? parsed.providerRef ?? null,
      balance_milli: balance, balance_source: balance === null ? null : src(sameAs(parsedMilli(parsed.balance), balance)),
      field_sources: {
        direction: src(sameAs(parsed.direction, req.direction)), amount: src(sameAs(parsedMilli(parsed.amount), amount)),
        occurredAt: occurredSource === 'SMS' ? 'PARSER' : occurredSource, counterpartyName: src(sameAs(parsed.counterpartyName, req.counterpartyName)),
        counterpartyPhone: src(sameAs(parsed.counterpartyPhone, req.counterpartyPhone)),
        ...(balance === null ? {} : { balance: src(sameAs(parsedMilli(parsed.balance), balance)) }),
      },
    };
  }
  await tx.query('SAVEPOINT classify');
  let updated: any;
  try {
    const { rows: u } = await tx.query(`
      UPDATE messages SET classification = $3, classification_source = 'MANUAL', direction = $4, amount_milli = $5, currency = $6,
        occurred_at = $7, occurred_at_source = $8, counterparty_name = $9, counterparty_phone = $10, provider_ref = $11,
        balance_milli = $12, balance_source = $13, field_sources = $14, version = version + 1, updated_at = $15,
        updated_by_device_id = $16, change_seq = nextval('change_seq')
      WHERE account_id = $1 AND id = $2 RETURNING *`,
      [actor.accountId, id, next.classification, next.direction, next.amount_milli, next.currency, next.occurred_at, next.occurred_at_source,
        next.counterparty_name, next.counterparty_phone, next.provider_ref, next.balance_milli, next.balance_source,
        JSON.stringify(next.field_sources), now.toISOString(), actor.deviceId]);
    updated = u[0];
    await tx.query('RELEASE SAVEPOINT classify');
  } catch (e) {
    await tx.query('ROLLBACK TO SAVEPOINT classify');
    if (isUniqueViolation(e, 'messages_provider_ref')) throw new ApiError(409, 'DUPLICATE_REFERENCE', 'Tixraacan (reference) horay ayaa loogu diiwaangeliyay dhaqdhaqaaq kale.');
    throw e;
  }
  await tx.query(`INSERT INTO message_changes (account_id, message_id, action, actor_device_id, actor_device_name, from_version, to_version, previous, next)
    VALUES ($1,$2,'CLASSIFY',$3,$4,$5,$6,$7,$8)`,
    [actor.accountId, id, actor.deviceId, actor.deviceName, current.version, updated.version, JSON.stringify(snapshot(current)),
      JSON.stringify({ ...snapshot(updated), note: req.note })]);
  await notifyAccount(tx, actor.accountId);
  return serializeMessage(updated);
}

function toMilliString(decimal: string): string {
  const [w, f = ''] = decimal.split('.');
  return (BigInt(w) * 1000n + BigInt((f + '000').slice(0, 3))).toString();
}

// ---------------------------------------------------------------------------------------------------------------
// Reprocessing (parser upgrades). Manual corrections are never overwritten.
// ---------------------------------------------------------------------------------------------------------------
export async function reprocessMessage(tx: Tx, accountId: string, id: string, actorName = 'parser') {
  const { rows } = await tx.query('SELECT * FROM messages WHERE account_id = $1 AND id = $2 FOR UPDATE', [accountId, id]);
  const current = rows[0];
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Message not found');
  const parsed = parseEvcSms(current.body, { timeZone: EVC_TIMEZONE, receivedAt: new Date(current.received_at) });
  const reasons: string[] = current.parsed?.reviewReasons ?? [];
  const parsedValue = JSON.stringify(parsedJson(parsed, reasons));
  if (current.classification_source === 'MANUAL') {
    await tx.query(`UPDATE messages SET parser_version = $3, parsed = $4, change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2`,
      [accountId, id, parsed.parserVersion, parsedValue]);
    return { changed: false, manual: true };
  }
  let eff = effectiveFromParse(reasons.includes('DUPLICATE_REFERENCE') ? { ...parsed, autoConfirm: false } : parsed, new Date(current.received_at).toISOString());
  const before = JSON.stringify(snapshot(current));
  const candidate = { ...current, ...eff };
  if (JSON.stringify(snapshot(candidate)) === before) {
    await tx.query(`UPDATE messages SET parser_version = $3, parsed = $4 WHERE account_id = $1 AND id = $2`, [accountId, id, parsed.parserVersion, parsedValue]);
    return { changed: false, manual: false };
  }
  const { rows: u } = await tx.query(`
    UPDATE messages SET parser_version = $3, parsed = $4, classification = $5, direction = $6, amount_milli = $7, currency = $8,
      occurred_at = $9, occurred_at_source = $10, counterparty_name = $11, counterparty_phone = $12, provider_ref = $13,
      balance_milli = $14, balance_source = $15, field_sources = $16, version = version + 1, updated_at = now(), change_seq = nextval('change_seq')
    WHERE account_id = $1 AND id = $2 RETURNING *`,
    [accountId, id, parsed.parserVersion, parsedValue, eff.classification, eff.direction, eff.amount_milli, eff.currency, eff.occurred_at,
      eff.occurred_at_source, eff.counterparty_name, eff.counterparty_phone, eff.provider_ref, eff.balance_milli, eff.balance_source,
      JSON.stringify(eff.field_sources)]);
  await tx.query(`INSERT INTO message_changes (account_id, message_id, action, actor_device_id, actor_device_name, from_version, to_version, previous, next)
    VALUES ($1,$2,'REPROCESS',NULL,$3,$4,$5,$6,$7)`, [accountId, id, actorName, current.version, u[0].version, before, JSON.stringify(snapshot(u[0]))]);
  await notifyAccount(tx, accountId);
  return { changed: true, manual: false };
}
