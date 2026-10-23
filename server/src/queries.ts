import { periodRange, toDecimalString, type PeriodKind } from '@toosh/shared';
import type { Tx } from './db.ts';
import { ApiError, serializeMessage } from './messages.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RangeQuery { period?: string; from?: string; to?: string }

/** Optional date range in the account timezone; "all" or nothing means no range. */
export function resolveRange(q: RangeQuery, tz: string, now = new Date()): { start: Date; end: Date } | null {
  const period = q.period ?? 'all';
  if (period === 'all') return null;
  if (!['today', 'week', 'month', 'custom'].includes(period)) throw new ApiError(400, 'INVALID_PERIOD', 'Muddo aan sax ahayn.');
  try { return periodRange(period as PeriodKind, tz, now, q.from, q.to); }
  catch (e) { throw new ApiError(400, 'INVALID_PERIOD', (e as Error).message); }
}

export function encodeCursor(t: Date | string, id: string) { return Buffer.from(JSON.stringify([new Date(t).toISOString(), id])).toString('base64url'); }
export function decodeCursor(c: string | undefined): [string, string] | null {
  if (!c) return null;
  try {
    const [t, id] = JSON.parse(Buffer.from(c, 'base64url').toString());
    if (typeof t === 'string' && Number.isFinite(Date.parse(t)) && typeof id === 'string' && UUID.test(id)) return [t, id];
  } catch { /* fallthrough */ }
  throw new ApiError(400, 'INVALID_CURSOR', 'Bogga xiga lama heli karo.');
}

/** Builds WHERE clauses with numbered parameters. */
export class Where {
  parts: string[] = []; params: unknown[] = [];
  add(sql: string, ...values: unknown[]) {
    let s = sql;
    for (const v of values) { this.params.push(v); s = s.replace('?', `$${this.params.length}`); }
    this.parts.push(s); return this;
  }
  get sql() { return this.parts.length ? this.parts.join(' AND ') : 'TRUE'; }
}

function searchClause(w: Where, q: string | undefined, inbox: boolean) {
  const text = (q ?? '').trim().slice(0, 80);
  if (!text) return;
  const like = `%${text.replace(/[\\%_]/g, m => '\\' + m)}%`;
  const digits = text.replace(/\D/g, '');
  const cols = ['counterparty_name', 'counterparty_phone', 'provider_ref', ...(inbox ? ['body', 'sender'] : [])];
  const ors = cols.map(c => `${c} ILIKE ?`);
  const values: unknown[] = cols.map(() => like);
  if (digits.length >= 4) {
    // "0615 99 88 22" finds "+252615998822" and numbers inside the SMS text.
    const dl = `%${digits.replace(/^0+/, '')}%`;
    ors.push(`regexp_replace(coalesce(counterparty_phone, ''), '\\D', '', 'g') LIKE ?`); values.push(dl);
    if (inbox) { ors.push(`regexp_replace(body, '\\D', '', 'g') LIKE ?`); values.push(dl); }
  }
  w.add(`(${ors.join(' OR ')})`, ...values);
}

export interface ListQuery extends RangeQuery { filter?: string; q?: string; cursor?: string; limit?: string; evcNumberId?: string }

/** Inbox: every imported message, newest receipt first. */
export async function listMessages(tx: Tx, accountId: string, tz: string, query: ListQuery) {
  const limit = Math.min(Math.max(Number(query.limit ?? 30) || 30, 1), 100);
  const range = resolveRange(query, tz);
  const base = new Where().add('account_id = ?', accountId);
  if (query.evcNumberId) { if (!UUID.test(query.evcNumberId)) throw new ApiError(400, 'INVALID_NUMBER', 'Lambar aan sax ahayn.'); base.add('evc_number_id = ?', query.evcNumberId); }
  if (range) base.add('received_at >= ?', range.start.toISOString()).add('received_at < ?', range.end.toISOString());
  searchClause(base, query.q, true);
  const counts = (await tx.query(`SELECT count(*)::int AS all,
      count(*) FILTER (WHERE classification = 'TRANSACTION' AND direction = 'IN')::int AS "in",
      count(*) FILTER (WHERE classification = 'TRANSACTION' AND direction = 'OUT')::int AS out,
      count(*) FILTER (WHERE classification = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE classification = 'NOT_TRANSACTION')::int AS ignored
    FROM messages WHERE ${base.sql}`, base.params)).rows[0];
  const w = new Where(); w.parts = [...base.parts]; w.params = [...base.params];
  const filter = query.filter ?? 'all';
  if (filter === 'in' || filter === 'out') w.add(`classification = 'TRANSACTION' AND direction = ?`, filter.toUpperCase());
  else if (filter === 'pending') w.add(`classification = 'PENDING'`);
  else if (filter === 'ignored') w.add(`classification = 'NOT_TRANSACTION'`);
  else if (filter !== 'all') throw new ApiError(400, 'INVALID_FILTER', 'Shaandheyn aan sax ahayn.');
  const cursor = decodeCursor(query.cursor);
  if (cursor) w.add('(received_at, id) < (?::timestamptz, ?::uuid)', cursor[0], cursor[1]);
  const { rows } = await tx.query(`SELECT * FROM messages WHERE ${w.sql} ORDER BY received_at DESC, id DESC LIMIT ${limit + 1}`, w.params);
  const items = rows.slice(0, limit).map(serializeMessage);
  const last = rows[limit - 1];
  return { items, counts, nextCursor: rows.length > limit ? encodeCursor(last.received_at, last.id) : null };
}

/** Confirmed transactions only, newest transaction time first, with totals for the same filters. */
export async function listTransactions(tx: Tx, accountId: string, tz: string, query: ListQuery) {
  const limit = Math.min(Math.max(Number(query.limit ?? 30) || 30, 1), 100);
  const range = resolveRange(query, tz);
  const base = new Where().add('account_id = ?', accountId).add(`classification = 'TRANSACTION'`);
  if (query.evcNumberId) { if (!UUID.test(query.evcNumberId)) throw new ApiError(400, 'INVALID_NUMBER', 'Lambar aan sax ahayn.'); base.add('evc_number_id = ?', query.evcNumberId); }
  if (range) base.add('occurred_at >= ?', range.start.toISOString()).add('occurred_at < ?', range.end.toISOString());
  searchClause(base, query.q, false);
  const totals = (await tx.query(`SELECT
      coalesce(sum(amount_milli) FILTER (WHERE direction = 'IN'), 0)::text AS incoming, count(*) FILTER (WHERE direction = 'IN')::int AS incoming_count,
      coalesce(sum(amount_milli) FILTER (WHERE direction = 'OUT'), 0)::text AS outgoing, count(*) FILTER (WHERE direction = 'OUT')::int AS outgoing_count
    FROM messages WHERE ${base.sql}`, base.params)).rows[0];
  const w = new Where(); w.parts = [...base.parts]; w.params = [...base.params];
  if (query.filter === 'in' || query.filter === 'out') w.add('direction = ?', query.filter.toUpperCase());
  else if (query.filter && query.filter !== 'all') throw new ApiError(400, 'INVALID_FILTER', 'Shaandheyn aan sax ahayn.');
  const cursor = decodeCursor(query.cursor);
  if (cursor) w.add('(occurred_at, id) < (?::timestamptz, ?::uuid)', cursor[0], cursor[1]);
  const { rows } = await tx.query(`SELECT * FROM messages WHERE ${w.sql} ORDER BY occurred_at DESC, id DESC LIMIT ${limit + 1}`, w.params);
  const last = rows[limit - 1];
  return {
    items: rows.slice(0, limit).map(serializeMessage),
    totals: {
      incoming: toDecimalString(BigInt(totals.incoming)), incomingCount: totals.incoming_count,
      outgoing: toDecimalString(BigInt(totals.outgoing)), outgoingCount: totals.outgoing_count,
    },
    nextCursor: rows.length > limit ? encodeCursor(last.occurred_at, last.id) : null,
    range: range ? { start: range.start.toISOString(), end: range.end.toISOString() } : null,
  };
}

/** Newest eligible SMS-reported balance per number, by when the balance was true (not by arrival order). */
export async function latestBalances(tx: Tx, accountId: string) {
  const { rows } = await tx.query(`
    SELECT DISTINCT ON (evc_number_id) evc_number_id, id, balance_milli, balance_source, balance_effective_at, classification
      FROM messages
     WHERE account_id = $1 AND balance_milli IS NOT NULL AND classification <> 'PENDING'
     ORDER BY evc_number_id, balance_effective_at DESC, received_at DESC, id DESC`, [accountId]);
  return rows.map(r => ({
    evcNumberId: r.evc_number_id, messageId: r.id, amount: toDecimalString(BigInt(r.balance_milli)), currency: 'USD',
    source: r.balance_source, effectiveAt: new Date(r.balance_effective_at).toISOString(),
  }));
}

export async function summary(tx: Tx, accountId: string, tz: string, query: RangeQuery & { evcNumberId?: string }) {
  const range = resolveRange({ period: query.period ?? 'today', from: query.from, to: query.to }, tz)!;
  const params: unknown[] = [accountId, range.start.toISOString(), range.end.toISOString()];
  let numberSql = '';
  if (query.evcNumberId) { if (!UUID.test(query.evcNumberId)) throw new ApiError(400, 'INVALID_NUMBER', 'Lambar aan sax ahayn.'); params.push(query.evcNumberId); numberSql = ` AND evc_number_id = $4`; }
  const totals = (await tx.query(`SELECT
      coalesce(sum(amount_milli) FILTER (WHERE direction = 'IN'), 0)::text AS incoming, count(*) FILTER (WHERE direction = 'IN')::int AS incoming_count,
      coalesce(sum(amount_milli) FILTER (WHERE direction = 'OUT'), 0)::text AS outgoing, count(*) FILTER (WHERE direction = 'OUT')::int AS outgoing_count
    FROM messages WHERE account_id = $1 AND classification = 'TRANSACTION' AND occurred_at >= $2 AND occurred_at < $3${numberSql}`, params)).rows[0];
  const pending = (await tx.query(`SELECT count(*)::int AS n FROM messages WHERE account_id = $1 AND classification = 'PENDING'${query.evcNumberId ? ' AND evc_number_id = $2' : ''}`,
    query.evcNumberId ? [accountId, query.evcNumberId] : [accountId])).rows[0].n;
  const recent = (await tx.query(`SELECT * FROM messages WHERE account_id = $1 AND classification = 'TRANSACTION' AND occurred_at >= $2 AND occurred_at < $3${numberSql}
    ORDER BY occurred_at DESC, id DESC LIMIT 5`, params)).rows.map(serializeMessage);
  const balances = await latestBalances(tx, accountId);
  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString(), timezone: tz, period: query.period ?? 'today' },
    incoming: { total: toDecimalString(BigInt(totals.incoming)), count: totals.incoming_count },
    outgoing: { total: toDecimalString(BigInt(totals.outgoing)), count: totals.outgoing_count },
    pendingCount: pending,
    balances: query.evcNumberId ? balances.filter(b => b.evcNumberId === query.evcNumberId) : balances,
    recent,
  };
}

export async function messageDetail(tx: Tx, accountId: string, id: string) {
  if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Fariinta lama helin.');
  const { rows } = await tx.query('SELECT * FROM messages WHERE account_id = $1 AND id = $2', [accountId, id]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Fariinta lama helin.');
  const history = (await tx.query(`SELECT action, actor_device_id, actor_device_name, from_version, to_version, previous, next, changed_at
    FROM message_changes WHERE account_id = $1 AND message_id = $2 ORDER BY id`, [accountId, id])).rows.map(h => ({
      action: h.action, actorDeviceId: h.actor_device_id, actorDeviceName: h.actor_device_name, fromVersion: h.from_version,
      toVersion: h.to_version, previous: h.previous, next: h.next, changedAt: new Date(h.changed_at).toISOString(),
    }));
  return { message: serializeMessage(rows[0]), history };
}
