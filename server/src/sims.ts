/**
 * SIM card records (Dejinta → SIM Card). Each account sees and changes only its own rows: every query runs in the
 * caller's account transaction, and row-level security enforces account_id = app.account_id again.
 * Deleting a record removes only that row. It does not touch EVC numbers, messages or anything on the real SIM.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { localDate, SIM_PROVIDERS, validateSimCard } from '@toosh/shared';
import { isUniqueViolation, type Tx } from './db.ts';
import { notifyAccount } from './events.ts';
import { ApiError, type Actor } from './messages.ts';
import { Where } from './queries.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Ctx extends Actor { timezone: string }
type Scoped = <T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>) => Promise<T>;

const serialize = (r: any) => ({
  id: r.id, name: r.name, phone: r.phone, provider: r.provider,
  registeredOn: r.registered_on instanceof Date ? r.registered_on.toISOString().slice(0, 10) : String(r.registered_on).slice(0, 10),
  notes: r.notes, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

export function registerSimRoutes(app: FastifyInstance, h: { authed: (req: FastifyRequest) => Promise<void>; scoped: Scoped; ctx: (req: FastifyRequest) => Ctx }) {
  const { authed, scoped, ctx } = h;
  const pre = { preHandler: authed };
  const notFound = () => new ApiError(404, 'NOT_FOUND', 'SIM-kan lama helin.');
  const duplicate = () => new ApiError(409, 'PHONE_EXISTS', 'Lambarkan horay ayaa loogu daray SIM Card-yadaada.', { phone: 'Lambarkan horay ayaa loo diiwaangeliyay.' });
  const today = (req: FastifyRequest) => localDate(new Date(), ctx(req).timezone);
  const validate = (req: FastifyRequest) => {
    const v = validateSimCard(req.body, today(req));
    if (!v.ok) throw new ApiError(400, 'VALIDATION', 'Hubi xogta SIM-ka.', v.errors);
    return v.value;
  };

  /** List with optional search (name, number, notes) and network filter. */
  app.get('/api/v1/sim-cards', pre, async req => scoped(req, async tx => {
    const q: any = req.query ?? {};
    const w = new Where().add('account_id = ?', ctx(req).accountId);
    if (q.provider && q.provider !== 'all') {
      if (!SIM_PROVIDERS.includes(q.provider)) throw new ApiError(400, 'INVALID_FILTER', 'Shaandheyn aan sax ahayn.');
      w.add('provider = ?', q.provider);
    }
    const text = String(q.q ?? '').trim().slice(0, 80);
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, m => '\\' + m)}%`;
      const digits = text.replace(/\D/g, '').replace(/^(00252|252|0)/, '');
      if (digits.length >= 3) w.add('(name ILIKE ? OR coalesce(notes, \'\') ILIKE ? OR phone LIKE ?)', like, like, `%${digits}%`);
      else w.add('(name ILIKE ? OR coalesce(notes, \'\') ILIKE ?)', like, like);
    }
    const { rows } = await tx.query(`SELECT * FROM sim_cards WHERE ${w.sql} ORDER BY lower(name), created_at`, w.params);
    const total = (await tx.query('SELECT count(*)::int AS n FROM sim_cards WHERE account_id = $1', [ctx(req).accountId])).rows[0].n;
    return { simCards: rows.map(serialize), total };
  }));

  app.post('/api/v1/sim-cards', pre, async (req, reply) => {
    const v = validate(req);
    try {
      const row = await scoped(req, async tx => {
        const { rows } = await tx.query(`INSERT INTO sim_cards (id, account_id, name, phone, provider, registered_on, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [randomUUID(), ctx(req).accountId, v.name, v.phone, v.provider, v.registeredOn, v.notes]);
        await notifyAccount(tx, ctx(req).accountId);
        return rows[0];
      });
      return reply.status(201).send({ simCard: serialize(row) });
    } catch (e) { if (isUniqueViolation(e)) throw duplicate(); throw e; }
  });

  app.put<{ Params: { id: string } }>('/api/v1/sim-cards/:id', pre, async req => {
    if (!UUID.test(req.params.id)) throw notFound();
    const v = validate(req);
    try {
      return await scoped(req, async tx => {
        const { rows } = await tx.query(`UPDATE sim_cards SET name = $3, phone = $4, provider = $5, registered_on = $6, notes = $7, updated_at = now(),
            change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2 RETURNING *`,
          [ctx(req).accountId, req.params.id, v.name, v.phone, v.provider, v.registeredOn, v.notes]);
        if (!rows[0]) throw notFound();
        await notifyAccount(tx, ctx(req).accountId);
        return { simCard: serialize(rows[0]) };
      });
    } catch (e) { if (isUniqueViolation(e)) throw duplicate(); throw e; }
  });

  /** Deletes this one record of the caller's own account. Nothing else is removed. */
  app.delete<{ Params: { id: string } }>('/api/v1/sim-cards/:id', pre, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw notFound();
    const { rows } = await tx.query('DELETE FROM sim_cards WHERE account_id = $1 AND id = $2 RETURNING name', [ctx(req).accountId, req.params.id]);
    if (!rows[0]) throw notFound();
    // A deleted row cannot raise the account's change number, so the device's own row does it for other devices.
    await tx.query(`UPDATE devices SET change_seq = nextval('change_seq') WHERE id = $1`, [ctx(req).deviceId]);
    await notifyAccount(tx, ctx(req).accountId);
    return { ok: true, name: rows[0].name };
  }));
}
