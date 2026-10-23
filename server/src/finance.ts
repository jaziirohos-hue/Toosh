/**
 * Expenses, categories, budgets, savings goals and the money overview.
 * Spending = outgoing EVC Plus transactions (USD, from SMS) + expenses entered by hand (USD or SOS) that are paid.
 * Every query runs inside the caller's account transaction, so row-level security limits it to that account.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  BUILTIN_CATEGORIES, CUSTOM_CATEGORY_ICONS, categoryRefString, localDate, parseCategoryRef, toDecimalString,
  validateBudget, validateExpense, validateGoal, type CategoryRef, type FinanceCurrency,
} from '@toosh/shared';
import { isUniqueViolation, type Tx } from './db.ts';
import { notifyAccount } from './events.ts';
import { ApiError, type Actor } from './messages.ts';
import { decodeCursor, encodeCursor, resolveRange, Where } from './queries.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dec = (v: string | number | bigint | null) => (v === null ? null : toDecimalString(BigInt(v)));
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
const day = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

interface Ctx extends Actor { timezone: string }
type Scoped = <T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Category columns for a reference; a custom category must belong to the account and (for new use) be active. */
async function categoryColumns(tx: Tx, accountId: string, ref: CategoryRef, allowArchived = false): Promise<{ key: string | null; customId: string | null }> {
  if (ref.kind === 'builtin') return { key: ref.key, customId: null };
  const { rows } = await tx.query('SELECT archived_at FROM expense_categories WHERE account_id = $1 AND id = $2', [accountId, ref.id]);
  if (!rows[0] || (rows[0].archived_at && !allowArchived)) throw new ApiError(400, 'VALIDATION', 'Hubi xogta.', { category: 'Qaybtan lama helin.' });
  return { key: null, customId: ref.id };
}

function categoryFilter(w: Where, raw: string | undefined, keyCol: string, idCol: string) {
  if (!raw || raw === 'all') return;
  if (raw === 'uncategorized') { w.add(`${keyCol} IS NULL AND ${idCol} IS NULL`); return; }
  const ref = parseCategoryRef(raw);
  if (!ref) throw new ApiError(400, 'INVALID_CATEGORY', 'Qayb aan sax ahayn.');
  if (ref.kind === 'builtin') w.add(`${keyCol} = ?`, ref.key); else w.add(`${idCol} = ?`, ref.id);
}

/** Local calendar days [from, to) covering an instant range in the account timezone. */
const dayRange = (r: { start: Date; end: Date }, tz: string) => ({ from: localDate(r.start, tz), to: localDate(r.end, tz) });

/** Paid spending per currency in a range, optionally for one category (EVC payments count as USD). */
async function spendTotals(tx: Tx, accountId: string, tz: string, range: { start: Date; end: Date }, category?: { key: string | null; customId: string | null } | null) {
  const d = dayRange(range, tz);
  const evc = new Where().add('m.account_id = ?', accountId).add(`m.classification = 'TRANSACTION' AND m.direction = 'OUT'`)
    .add('m.occurred_at >= ?', range.start.toISOString()).add('m.occurred_at < ?', range.end.toISOString());
  const man = new Where().add('account_id = ?', accountId).add(`deleted_at IS NULL AND payment_status = 'PAID'`)
    .add('spent_on >= ?', d.from).add('spent_on < ?', d.to);
  if (category) {
    if (category.key) { evc.add('tc.category_key = ?', category.key); man.add('category_key = ?', category.key); }
    else { evc.add('tc.custom_category_id = ?', category.customId); man.add('custom_category_id = ?', category.customId); }
  }
  const totals: Record<FinanceCurrency, bigint> = { USD: 0n, SOS: 0n };
  const a = await tx.query(`SELECT coalesce(sum(m.amount_milli), 0)::text AS t FROM messages m LEFT JOIN transaction_categories tc ON tc.message_id = m.id WHERE ${evc.sql}`, evc.params);
  totals.USD += BigInt(a.rows[0].t);
  const b = await tx.query(`SELECT currency, sum(amount_milli)::text AS t FROM expenses WHERE ${man.sql} GROUP BY currency`, man.params);
  for (const r of b.rows) totals[r.currency as FinanceCurrency] += BigInt(r.t);
  return totals;
}
const totalsWire = (t: Record<FinanceCurrency, bigint>) => ({ USD: dec(t.USD), SOS: dec(t.SOS) });

function serializeExpense(e: any) {
  return {
    id: e.id, name: e.name, amount: dec(e.amount_milli), currency: e.currency, category: categoryRefString(e.category_key, e.custom_category_id),
    spentOn: day(e.spent_on), description: e.description, paymentStatus: e.payment_status, version: e.version,
    createdAt: iso(e.created_at), updatedAt: iso(e.updated_at),
  };
}
function serializeCustom(c: any) {
  return { id: c.id, ref: `custom:${c.id}`, name: c.name, icon: c.icon, archived: Boolean(c.archived_at) };
}
function serializeGoal(g: any) {
  return { id: g.id, name: g.name, target: dec(g.target_milli), saved: dec(g.saved_milli), currency: g.currency, targetDate: day(g.target_date), createdAt: iso(g.created_at) };
}

const BUDGET_RANGE: Record<string, 'today' | 'week' | 'month'> = { DAILY: 'today', WEEKLY: 'week', MONTHLY: 'month' };
async function budgetStatus(tx: Tx, ctx: Ctx) {
  const { rows } = await tx.query('SELECT * FROM budgets WHERE account_id = $1 ORDER BY period, currency, created_at', [ctx.accountId]);
  const out = [];
  for (const b of rows) {
    const range = resolveRange({ period: BUDGET_RANGE[b.period] }, ctx.timezone)!;
    const category = b.category_key || b.custom_category_id ? { key: b.category_key, customId: b.custom_category_id } : null;
    const spent = (await spendTotals(tx, ctx.accountId, ctx.timezone, range, category))[b.currency as FinanceCurrency];
    const limit = BigInt(b.amount_milli);
    const percent = Number((spent * 1000n) / limit) / 10;
    const status = spent > limit ? 'OVER' : percent >= b.alert_percent ? 'WARNING' : 'OK';
    out.push({
      id: b.id, period: b.period, category: categoryRefString(b.category_key, b.custom_category_id), amount: dec(limit), currency: b.currency,
      alertPercent: b.alert_percent, spent: dec(spent), remaining: dec(limit - spent), percent, status,
      periodStart: range.start.toISOString(), periodEnd: range.end.toISOString(),
    });
  }
  return out;
}

export function registerFinanceRoutes(app: FastifyInstance, h: { authed: (req: FastifyRequest) => Promise<void>; scoped: Scoped; ctx: (req: FastifyRequest) => Ctx }) {
  const { authed, scoped, ctx } = h;
  const pre = { preHandler: authed };
  const notFound = (what = 'Lama helin.') => new ApiError(404, 'NOT_FOUND', what);

  // ---------------------------------------------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------------------------------------------
  app.get('/api/v1/categories', pre, async req => scoped(req, async tx => {
    const { rows } = await tx.query('SELECT * FROM expense_categories WHERE account_id = $1 ORDER BY archived_at NULLS FIRST, lower(name)', [ctx(req).accountId]);
    return { builtin: BUILTIN_CATEGORIES, custom: rows.map(serializeCustom), icons: CUSTOM_CATEGORY_ICONS };
  }));

  const categoryBody = (b: any) => {
    const errors: Record<string, string> = {};
    const name = typeof b?.name === 'string' && b.name.trim() && b.name.trim().length <= 40 ? b.name.trim() : null;
    if (!name) errors.name = 'Geli magaca qaybta (ilaa 40 xaraf).';
    if (!CUSTOM_CATEGORY_ICONS.includes(b?.icon)) errors.icon = 'Dooro calaamad.';
    if (Object.keys(errors).length) throw new ApiError(400, 'VALIDATION', 'Hubi xogta.', errors);
    return { name: name!, icon: b.icon as string };
  };
  const nameTaken = () => new ApiError(409, 'CATEGORY_EXISTS', 'Qayb magacan leh ayaa horay u jirtay.', { name: 'Magacan horay ayaa loo isticmaalay.' });

  app.post('/api/v1/categories', pre, async (req, reply) => {
    const v = categoryBody(req.body);
    try {
      const row = await scoped(req, async tx => {
        const { rows } = await tx.query('INSERT INTO expense_categories (id, account_id, name, icon) VALUES ($1,$2,$3,$4) RETURNING *', [randomUUID(), ctx(req).accountId, v.name, v.icon]);
        await notifyAccount(tx, ctx(req).accountId);
        return rows[0];
      });
      return reply.status(201).send(serializeCustom(row));
    } catch (e) { if (isUniqueViolation(e)) throw nameTaken(); throw e; }
  });

  app.patch<{ Params: { id: string } }>('/api/v1/categories/:id', pre, async req => {
    if (!UUID.test(req.params.id)) throw notFound('Qaybta lama helin.');
    const v = categoryBody(req.body);
    try {
      return await scoped(req, async tx => {
        const { rows } = await tx.query(`UPDATE expense_categories SET name = $3, icon = $4, change_seq = nextval('change_seq')
          WHERE account_id = $1 AND id = $2 AND archived_at IS NULL RETURNING *`, [ctx(req).accountId, req.params.id, v.name, v.icon]);
        if (!rows[0]) throw notFound('Qaybta lama helin.');
        await notifyAccount(tx, ctx(req).accountId);
        return serializeCustom(rows[0]);
      });
    } catch (e) { if (isUniqueViolation(e)) throw nameTaken(); throw e; }
  });

  /** Archives a category: past expenses keep it; it can no longer be chosen; its budgets are removed. */
  app.delete<{ Params: { id: string } }>('/api/v1/categories/:id', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw notFound('Qaybta lama helin.');
    const { rowCount } = await tx.query(`UPDATE expense_categories SET archived_at = now(), change_seq = nextval('change_seq')
      WHERE account_id = $1 AND id = $2 AND archived_at IS NULL`, [ctx(req).accountId, req.params.id]);
    if (!rowCount) throw notFound('Qaybta lama helin.');
    await tx.query('DELETE FROM budgets WHERE account_id = $1 AND custom_category_id = $2', [ctx(req).accountId, req.params.id]);
    await notifyAccount(tx, ctx(req).accountId);
    return { ok: true };
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // Expenses entered by hand
  // ---------------------------------------------------------------------------------------------------------------
  const today = (req: FastifyRequest) => localDate(new Date(), ctx(req).timezone);

  app.post('/api/v1/expenses', pre, async (req, reply) => {
    const v = validateExpense(req.body, today(req));
    if (!v.ok) throw new ApiError(400, 'VALIDATION', 'Hubi xogta qarashka.', v.errors);
    const e = await scoped(req, async tx => {
      const c = await categoryColumns(tx, ctx(req).accountId, v.value.category);
      const { rows } = await tx.query(`INSERT INTO expenses (id, account_id, name, amount_milli, currency, category_key, custom_category_id, spent_on,
          description, payment_status, created_by_device_id, updated_by_device_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
        [randomUUID(), ctx(req).accountId, v.value.name, v.value.amountMilli.toString(), v.value.currency, c.key, c.customId, v.value.spentOn,
          v.value.description, v.value.paymentStatus, ctx(req).deviceId]);
      await notifyAccount(tx, ctx(req).accountId);
      return rows[0];
    });
    return reply.status(201).send({ expense: serializeExpense(e) });
  });

  app.get<{ Params: { id: string } }>('/api/v1/expenses/:id', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw notFound('Qarashka lama helin.');
    const { rows } = await tx.query('SELECT * FROM expenses WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL', [ctx(req).accountId, req.params.id]);
    if (!rows[0]) throw notFound('Qarashka lama helin.');
    return { expense: serializeExpense(rows[0]) };
  }));

  /** Full update. `expectedVersion` stops one device silently overwriting another device's newer edit. */
  app.put<{ Params: { id: string } }>('/api/v1/expenses/:id', pre, async req => {
    if (!UUID.test(req.params.id)) throw notFound('Qarashka lama helin.');
    const b: any = req.body ?? {};
    const v = validateExpense(b, today(req));
    if (!v.ok) throw new ApiError(400, 'VALIDATION', 'Hubi xogta qarashka.', v.errors);
    if (!Number.isInteger(b.expectedVersion)) throw new ApiError(400, 'VALIDATION', 'Hubi xogta qarashka.', { expectedVersion: 'required' });
    return scoped(req, async tx => {
      const cur = (await tx.query('SELECT * FROM expenses WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE', [ctx(req).accountId, req.params.id])).rows[0];
      if (!cur) throw notFound('Qarashka lama helin.');
      if (cur.version !== b.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'Aalad kale ayaa beddeshay qarashkan. Eeg kan cusub.', { current: serializeExpense(cur) });
      const sameCustom = v.value.category.kind === 'custom' && v.value.category.id === cur.custom_category_id;
      const c = await categoryColumns(tx, ctx(req).accountId, v.value.category, sameCustom);
      const { rows } = await tx.query(`UPDATE expenses SET name = $3, amount_milli = $4, currency = $5, category_key = $6, custom_category_id = $7,
          spent_on = $8, description = $9, payment_status = $10, updated_by_device_id = $11, version = version + 1, updated_at = now(),
          change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2 RETURNING *`,
        [ctx(req).accountId, req.params.id, v.value.name, v.value.amountMilli.toString(), v.value.currency, c.key, c.customId, v.value.spentOn,
          v.value.description, v.value.paymentStatus, ctx(req).deviceId]);
      await notifyAccount(tx, ctx(req).accountId);
      return { expense: serializeExpense(rows[0]) };
    });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/expenses/:id', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw notFound('Qarashka lama helin.');
    const { rowCount } = await tx.query(`UPDATE expenses SET deleted_at = now(), updated_by_device_id = $3, change_seq = nextval('change_seq')
      WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL`, [ctx(req).accountId, req.params.id, ctx(req).deviceId]);
    if (!rowCount) throw notFound('Qarashka lama helin.');
    await notifyAccount(tx, ctx(req).accountId);
    return { ok: true };
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // Category of an outgoing EVC Plus payment
  // ---------------------------------------------------------------------------------------------------------------
  app.put<{ Params: { id: string } }>('/api/v1/messages/:id/category', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw notFound('Fariinta lama helin.');
    const raw = (req.body as any)?.category;
    const m = (await tx.query('SELECT id, classification, direction FROM messages WHERE account_id = $1 AND id = $2', [ctx(req).accountId, req.params.id])).rows[0];
    if (!m) throw notFound('Fariinta lama helin.');
    if (m.classification !== 'TRANSACTION' || m.direction !== 'OUT') throw new ApiError(400, 'NOT_OUTGOING', 'Qayb waxaa la siin karaa lacag baxday oo keliya.');
    if (raw === null || raw === '') {
      await tx.query('DELETE FROM transaction_categories WHERE account_id = $1 AND message_id = $2', [ctx(req).accountId, m.id]);
      // Removing the row leaves no change_seq behind; bump the message so other devices refresh.
      await tx.query(`UPDATE messages SET change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2`, [ctx(req).accountId, m.id]);
      await notifyAccount(tx, ctx(req).accountId);
      return { category: null };
    }
    const ref = parseCategoryRef(raw);
    if (!ref) throw new ApiError(400, 'VALIDATION', 'Hubi xogta.', { category: 'Qayb aan sax ahayn.' });
    const c = await categoryColumns(tx, ctx(req).accountId, ref);
    await tx.query(`INSERT INTO transaction_categories (message_id, account_id, category_key, custom_category_id, updated_by_device_id)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (message_id) DO UPDATE SET category_key = EXCLUDED.category_key, custom_category_id = EXCLUDED.custom_category_id,
        updated_by_device_id = EXCLUDED.updated_by_device_id, updated_at = now(), change_seq = nextval('change_seq')`,
      [m.id, ctx(req).accountId, c.key, c.customId, ctx(req).deviceId]);
    await notifyAccount(tx, ctx(req).accountId);
    return { category: categoryRefString(c.key, c.customId) };
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // Spending feed: outgoing EVC payments and hand-entered expenses together, newest first
  // ---------------------------------------------------------------------------------------------------------------
  app.get('/api/v1/spending', pre, async req => scoped(req, async tx => {
    const q: any = req.query ?? {};
    const { accountId, timezone: tz } = ctx(req);
    const limit = Math.min(Math.max(Number(q.limit ?? 30) || 30, 1), 100);
    const range = resolveRange(q, tz);
    const w = new Where();
    if (range) { const d = dayRange(range, tz); w.add('spent_on >= ?::date', d.from).add('spent_on < ?::date', d.to); }
    categoryFilter(w, q.category, 'category_key', 'custom_category_id');
    if (q.source === 'evc') w.add(`source = 'EVC'`); else if (q.source === 'manual') w.add(`source = 'MANUAL'`);
    else if (q.source && q.source !== 'all') throw new ApiError(400, 'INVALID_FILTER', 'Shaandheyn aan sax ahayn.');
    if (q.status === 'paid' || q.status === 'unpaid') w.add('payment_status = ?', q.status.toUpperCase());
    if (q.currency === 'USD' || q.currency === 'SOS') w.add('currency = ?', q.currency);
    const text = String(q.q ?? '').trim().slice(0, 80);
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, m => '\\' + m)}%`;
      const digits = text.replace(/\D/g, '').replace(/^0+/, '');
      if (digits.length >= 4) w.add(`(name ILIKE ? OR coalesce(description, '') ILIKE ? OR regexp_replace(coalesce(counterparty_phone, ''), '\\D', '', 'g') LIKE ?)`, like, like, `%${digits}%`);
      else w.add(`(name ILIKE ? OR coalesce(description, '') ILIKE ?)`, like, like);
    }
    // The CTE takes $1 (account) and $2 (timezone); the filters above are renumbered after them.
    const items = `WITH items AS (
        SELECT 'EVC'::text AS source, m.id, coalesce(m.counterparty_name, m.counterparty_phone, 'EVC Plus') AS name, m.amount_milli, 'USD'::text AS currency,
          tc.category_key, tc.custom_category_id, m.occurred_at AS sort_at, (m.occurred_at AT TIME ZONE $2)::date AS spent_on,
          'PAID'::text AS payment_status, NULL::text AS description, m.counterparty_phone, NULL::integer AS version
        FROM messages m LEFT JOIN transaction_categories tc ON tc.message_id = m.id
        WHERE m.account_id = $1 AND m.classification = 'TRANSACTION' AND m.direction = 'OUT'
        UNION ALL
        SELECT 'MANUAL', e.id, e.name, e.amount_milli, e.currency, e.category_key, e.custom_category_id,
          ((e.spent_on + (e.created_at AT TIME ZONE $2)::time) AT TIME ZONE $2), e.spent_on, e.payment_status, e.description, NULL, e.version
        FROM expenses e WHERE e.account_id = $1 AND e.deleted_at IS NULL)`;
    const shift = (sql: string) => sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 2}`);
    const params = [accountId, tz, ...w.params];
    const totals = await tx.query(`${items} SELECT currency, payment_status, sum(amount_milli)::text AS t, count(*)::int AS n FROM items WHERE ${shift(w.sql)} GROUP BY currency, payment_status`, params);
    const sum: Record<string, { paid: string; unpaid: string; count: number }> = {};
    for (const r of totals.rows) {
      const s = (sum[r.currency] ??= { paid: '0.00', unpaid: '0.00', count: 0 });
      if (r.payment_status === 'PAID') s.paid = dec(r.t)!; else s.unpaid = dec(r.t)!;
      s.count += r.n;
    }
    const cursor = decodeCursor(q.cursor);
    const pw = new Where(); pw.parts = [...w.parts]; pw.params = [...w.params];
    if (cursor) pw.add('(sort_at, id) < (?::timestamptz, ?::uuid)', cursor[0], cursor[1]);
    const { rows } = await tx.query(`${items} SELECT * FROM items WHERE ${shift(pw.sql)} ORDER BY sort_at DESC, id DESC LIMIT ${limit + 1}`, [accountId, tz, ...pw.params]);
    const page = rows.slice(0, limit);
    return {
      items: page.map(r => ({
        source: r.source, id: r.id, name: r.name, amount: dec(r.amount_milli), currency: r.currency, category: categoryRefString(r.category_key, r.custom_category_id),
        at: iso(r.sort_at), spentOn: day(r.spent_on), paymentStatus: r.payment_status, description: r.description, counterpartyPhone: r.counterparty_phone, version: r.version,
      })),
      totals: sum,
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].sort_at, page[page.length - 1].id) : null,
    };
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------------------------------------------------
  app.get('/api/v1/budgets', pre, async req => scoped(req, async tx => ({ budgets: await budgetStatus(tx, ctx(req)) })));

  /** Creates or replaces the budget for one period + category + currency. */
  app.put('/api/v1/budgets', pre, async req => {
    const v = validateBudget(req.body);
    if (!v.ok) throw new ApiError(400, 'VALIDATION', 'Hubi xogta miisaaniyadda.', v.errors);
    return scoped(req, async tx => {
      const c = v.value.category ? await categoryColumns(tx, ctx(req).accountId, v.value.category) : { key: null, customId: null };
      const { rows } = await tx.query(`INSERT INTO budgets (id, account_id, period, category_key, custom_category_id, amount_milli, currency, alert_percent)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (account_id, period, currency, coalesce(category_key, ''), coalesce(custom_category_id, '00000000-0000-0000-0000-000000000000'::uuid))
          DO UPDATE SET amount_milli = EXCLUDED.amount_milli, alert_percent = EXCLUDED.alert_percent, updated_at = now(), change_seq = nextval('change_seq')
          RETURNING id`,
        [randomUUID(), ctx(req).accountId, v.value.period, c.key, c.customId, v.value.amountMilli.toString(), v.value.currency, v.value.alertPercent]);
      await notifyAccount(tx, ctx(req).accountId);
      return { budget: (await budgetStatus(tx, ctx(req))).find(b => b.id === rows[0].id) };
    });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/budgets/:id', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw notFound('Miisaaniyadda lama helin.');
    const { rowCount } = await tx.query('DELETE FROM budgets WHERE account_id = $1 AND id = $2', [ctx(req).accountId, req.params.id]);
    if (!rowCount) throw notFound('Miisaaniyadda lama helin.');
    // A deleted row leaves no change number; bump the account's devices row so pollers notice.
    await tx.query(`UPDATE devices SET change_seq = nextval('change_seq') WHERE id = $1`, [ctx(req).deviceId]);
    await notifyAccount(tx, ctx(req).accountId);
    return { ok: true };
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // Savings goals
  // ---------------------------------------------------------------------------------------------------------------
  app.get('/api/v1/goals', pre, async req => scoped(req, async tx => {
    const { rows } = await tx.query('SELECT * FROM savings_goals WHERE account_id = $1 AND archived_at IS NULL ORDER BY created_at', [ctx(req).accountId]);
    return { goals: rows.map(serializeGoal) };
  }));
  app.post('/api/v1/goals', pre, async (req, reply) => {
    const v = validateGoal(req.body);
    if (!v.ok) throw new ApiError(400, 'VALIDATION', 'Hubi xogta hadafka.', v.errors);
    const g = await scoped(req, async tx => {
      const { rows } = await tx.query(`INSERT INTO savings_goals (id, account_id, name, target_milli, saved_milli, currency, target_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [randomUUID(), ctx(req).accountId, v.value.name, v.value.targetMilli.toString(), v.value.savedMilli.toString(), v.value.currency, v.value.targetDate]);
      await notifyAccount(tx, ctx(req).accountId);
      return rows[0];
    });
    return reply.status(201).send({ goal: serializeGoal(g) });
  });
  app.put<{ Params: { id: string } }>('/api/v1/goals/:id', pre, async req => {
    if (!UUID.test(req.params.id)) throw notFound('Hadafka lama helin.');
    const v = validateGoal(req.body);
    if (!v.ok) throw new ApiError(400, 'VALIDATION', 'Hubi xogta hadafka.', v.errors);
    return scoped(req, async tx => {
      const { rows } = await tx.query(`UPDATE savings_goals SET name = $3, target_milli = $4, saved_milli = $5, currency = $6, target_date = $7, updated_at = now(),
          change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2 AND archived_at IS NULL RETURNING *`,
        [ctx(req).accountId, req.params.id, v.value.name, v.value.targetMilli.toString(), v.value.savedMilli.toString(), v.value.currency, v.value.targetDate]);
      if (!rows[0]) throw notFound('Hadafka lama helin.');
      await notifyAccount(tx, ctx(req).accountId);
      return { goal: serializeGoal(rows[0]) };
    });
  });
  app.delete<{ Params: { id: string } }>('/api/v1/goals/:id', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw notFound('Hadafka lama helin.');
    const { rowCount } = await tx.query(`UPDATE savings_goals SET archived_at = now(), change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx(req).accountId, req.params.id]);
    if (!rowCount) throw notFound('Hadafka lama helin.');
    await notifyAccount(tx, ctx(req).accountId);
    return { ok: true };
  }));

  // ---------------------------------------------------------------------------------------------------------------
  // Money overview for the dashboard
  // ---------------------------------------------------------------------------------------------------------------
  app.get('/api/v1/finance', pre, async req => scoped(req, async tx => {
    const q: any = req.query ?? {};
    const c = ctx(req);
    const range = resolveRange({ period: q.period ?? 'month', from: q.from, to: q.to }, c.timezone);
    const ranges = { today: resolveRange({ period: 'today' }, c.timezone)!, week: resolveRange({ period: 'week' }, c.timezone)!, month: resolveRange({ period: 'month' }, c.timezone)! };
    const inc = new Where().add('account_id = ?', c.accountId).add(`classification = 'TRANSACTION' AND direction = 'IN'`);
    if (range) inc.add('occurred_at >= ?', range.start.toISOString()).add('occurred_at < ?', range.end.toISOString());
    const income = BigInt((await tx.query(`SELECT coalesce(sum(amount_milli), 0)::text AS t FROM messages WHERE ${inc.sql}`, inc.params)).rows[0].t);
    const all = range ?? { start: new Date('2000-01-01T00:00:00Z'), end: new Date(Date.now() + 86400000) };
    const spent = await spendTotals(tx, c.accountId, c.timezone, all);
    // Unpaid hand-entered expenses in the range (bills still to pay); not counted as spending.
    const d = dayRange(all, c.timezone);
    const unpaidRows = (await tx.query(`SELECT currency, sum(amount_milli)::text AS t FROM expenses WHERE account_id = $1 AND deleted_at IS NULL
        AND payment_status = 'UNPAID' AND spent_on >= $2 AND spent_on < $3 GROUP BY currency`, [c.accountId, d.from, d.to])).rows;
    const unpaid: Record<FinanceCurrency, bigint> = { USD: 0n, SOS: 0n };
    for (const r of unpaidRows) unpaid[r.currency as FinanceCurrency] = BigInt(r.t);
    // Spending by category in the range (EVC payments without a category are "uncategorized").
    const cat = await tx.query(`
      SELECT coalesce(tc.category_key, CASE WHEN tc.custom_category_id IS NULL THEN 'uncategorized' END) AS key, tc.custom_category_id AS custom_id,
        'USD' AS currency, sum(m.amount_milli)::text AS t, count(*)::int AS n
      FROM messages m LEFT JOIN transaction_categories tc ON tc.message_id = m.id
      WHERE m.account_id = $1 AND m.classification = 'TRANSACTION' AND m.direction = 'OUT' AND m.occurred_at >= $2 AND m.occurred_at < $3
      GROUP BY 1, 2
      UNION ALL
      SELECT category_key, custom_category_id, currency, sum(amount_milli)::text, count(*)::int FROM expenses
      WHERE account_id = $1 AND deleted_at IS NULL AND payment_status = 'PAID' AND spent_on >= $4 AND spent_on < $5
      GROUP BY 1, 2, 3`, [c.accountId, all.start.toISOString(), all.end.toISOString(), d.from, d.to]);
    const byCat = new Map<string, { category: string; currency: string; amount: bigint; count: number }>();
    for (const r of cat.rows) {
      const ref = r.key === 'uncategorized' ? 'uncategorized' : categoryRefString(r.key, r.custom_id)!;
      const k = `${ref}|${r.currency}`;
      const e = byCat.get(k) ?? { category: ref, currency: r.currency, amount: 0n, count: 0 };
      e.amount += BigInt(r.t); e.count += r.n; byCat.set(k, e);
    }
    const categories = [...byCat.values()].sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1))
      .map(e => ({ category: e.category, currency: e.currency, amount: dec(e.amount), count: e.count }));
    // One transaction client runs one query at a time.
    const t = await spendTotals(tx, c.accountId, c.timezone, ranges.today);
    const w = await spendTotals(tx, c.accountId, c.timezone, ranges.week);
    const m = await spendTotals(tx, c.accountId, c.timezone, ranges.month);
    return {
      period: q.period ?? 'month',
      income: { USD: dec(income), SOS: '0.00' },
      expenses: totalsWire(spent),
      remaining: { USD: dec(income - spent.USD), SOS: dec(-spent.SOS) },
      unpaid: totalsWire(unpaid),
      spendingToday: totalsWire(t), spendingWeek: totalsWire(w), spendingMonth: totalsWire(m),
      categories,
      budgets: await budgetStatus(tx, c),
    };
  }));
}
