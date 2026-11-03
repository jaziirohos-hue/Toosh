/**
 * Taught message formats ("Bar Toosh"). A person teaches Toosh with one SMS; the rule then classifies later SMS
 * of the same format from the same sender (shared/src/rules.ts). Rules belong to one account (row-level security).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildRulePattern, matchRule, normalizeSender, type RuleDirection } from '@toosh/shared';
import type { Tx } from './db.ts';
import { notifyAccount } from './events.ts';
import { ApiError, loadRules, reprocessMessage, type Actor } from './messages.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RULES = 200;
type Scoped = <T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>) => Promise<T>;

const BUILD_ERRORS: Record<string, string> = {
  EMPTY: 'Fariintu waa madhan tahay.',
  AMOUNT_REQUIRED: 'Dooro qaddarka lacagta ee fariinta.',
  AMOUNT_NOT_FOUND: 'Qaddarkan fariinta laguma helin.',
  BALANCE_NOT_FOUND: 'Haraagan fariinta laguma helin.',
  NAME_NOT_FOUND: 'Magacan fariinta laguma helin.',
};

const serialize = (r: any) => ({ id: r.id, sender: r.sender, direction: r.direction, example: r.example, createdAt: new Date(r.created_at).toISOString() });

export function registerRuleRoutes(app: FastifyInstance, h: { authed: (req: FastifyRequest) => Promise<void>; scoped: Scoped; ctx: (req: FastifyRequest) => Actor }) {
  const { authed, scoped, ctx } = h;
  const pre = { preHandler: authed };

  app.get('/api/v1/rules', pre, async req => scoped(req, async tx => {
    const { rows } = await tx.query('SELECT * FROM message_rules WHERE account_id = $1 ORDER BY created_at DESC', [ctx(req).accountId]);
    return { rules: rows.map(serialize), patterns: rows.map(r => ({ id: r.id, sender: r.sender, pattern: r.pattern, direction: r.direction })) };
  }));

  /** Teach a format from one SMS; messages already waiting for review that fit it are sorted right away. */
  app.post('/api/v1/rules', pre, async (req, reply) => {
    const b: any = req.body ?? {};
    const errors: Record<string, string> = {};
    const sender = typeof b.sender === 'string' ? b.sender.trim() : '';
    if (!sender || sender.length > 64 || !normalizeSender(sender)) errors.sender = 'Diraha fariinta lama garanayo.';
    const body = typeof b.body === 'string' ? b.body : '';
    if (!body.trim() || body.length > 2000) errors.body = 'Fariin aan sax ahayn.';
    const direction = b.direction as RuleDirection;
    if (!['IN', 'OUT', 'NONE'].includes(direction)) errors.direction = 'Dooro: soo galay, baxay ama ma aha lacag.';
    if (Object.keys(errors).length) throw new ApiError(400, 'VALIDATION', 'Hubi xogta.', errors);
    const built = buildRulePattern({ body, direction, amount: b.amount ?? null, balance: b.balance || null, counterpartyName: b.counterpartyName || null });
    if (!built.ok) {
      const field = built.error.startsWith('BALANCE') ? 'balance' : built.error.startsWith('NAME') ? 'counterpartyName' : 'amount';
      throw new ApiError(400, 'VALIDATION', 'Hubi xogta.', { [field]: BUILD_ERRORS[built.error] ?? 'Hubi xogta.' });
    }
    // The rule must fit its own example, or it would never do anything.
    const self = { id: 'self', sender, pattern: built.pattern, direction };
    if (!matchRule([self], sender, body)) throw new ApiError(400, 'VALIDATION', 'Hubi xogta.', { body: 'Fariintan lagama samayn karo qaab.' });
    return scoped(req, async tx => {
      const count = (await tx.query('SELECT count(*)::int AS n FROM message_rules WHERE account_id = $1', [ctx(req).accountId])).rows[0].n;
      if (count >= MAX_RULES) throw new ApiError(400, 'TOO_MANY_RULES', `Ugu badnaan ${MAX_RULES} qaab ayaa la bari karaa.`);
      const { rows } = await tx.query(`INSERT INTO message_rules (id, account_id, sender, pattern, direction, example, created_by_device_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [randomUUID(), ctx(req).accountId, sender, built.pattern, direction, body.trim(), ctx(req).deviceId]);
      // Sort what is already waiting (never messages a person classified by hand).
      const rules = await loadRules(tx, ctx(req).accountId);
      const waiting = (await tx.query(`SELECT id FROM messages WHERE account_id = $1 AND classification = 'PENDING' AND classification_source = 'PARSER'
        ORDER BY received_at LIMIT 500`, [ctx(req).accountId])).rows;
      let sorted = 0;
      for (const m of waiting) if ((await reprocessMessage(tx, ctx(req).accountId, m.id, 'Bar Toosh', rules)).changed) sorted++;
      await notifyAccount(tx, ctx(req).accountId);
      return reply.status(201).send({ rule: serialize(rows[0]), pattern: { id: rows[0].id, sender, pattern: built.pattern, direction }, sorted });
    });
  });

  /** Forget a format. Messages it already sorted keep their classification (they can be changed by hand). */
  app.delete<{ Params: { id: string } }>('/api/v1/rules/:id', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'Qaabkan lama helin.');
    const { rowCount } = await tx.query('DELETE FROM message_rules WHERE account_id = $1 AND id = $2', [ctx(req).accountId, req.params.id]);
    if (!rowCount) throw new ApiError(404, 'NOT_FOUND', 'Qaabkan lama helin.');
    await tx.query(`UPDATE devices SET change_seq = nextval('change_seq') WHERE id = $1`, [ctx(req).deviceId]);
    await notifyAccount(tx, ctx(req).accountId);
    return { ok: true };
  }));
}
