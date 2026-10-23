import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { DEFAULT_TIMEZONE, normalizeSomaliMsisdn } from '@toosh/shared';
import {
  DUMMY_HASH, hashPassword, isTokenShaped, newDeviceToken, newPairingCode, newRecoveryCodes, normalizeRecoveryCode, pairingHash, sha256, validatePassword, verifyPassword,
} from './auth.ts';
import type { Config } from './config.ts';
import { inTx, isUniqueViolation, withAccount, type Db, type Tx } from './db.ts';
import { ChangeHub, notifyAccount } from './events.ts';
import { registerFinanceRoutes } from './finance.ts';
import { ApiError, classifyMessage, ingestBatch, type Actor } from './messages.ts';
import { latestBalances, listMessages, listTransactions, messageDetail, summary } from './queries.ts';

export const SESSION_COOKIE = 'toosh_session';

interface AuthContext extends Actor { role: 'SOURCE' | 'VIEWER'; platform: string; timezone: string; viaCookie: boolean }
declare module 'fastify' { interface FastifyRequest { auth?: AuthContext } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = ['android', 'web', 'ios', 'other'];
const shortText = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v.trim() : null);

function deviceInfo(raw: any) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const platform = PLATFORMS.includes(d.platform) ? d.platform : 'other';
  return {
    name: shortText(d.name, 80) ?? (platform === 'web' ? 'Browser' : 'Device'), platform,
    model: shortText(d.model, 80), appVersion: shortText(d.appVersion, 40),
  };
}

function serializeDevice(d: any, currentId?: string) {
  const at = (v: any) => (v ? new Date(v).toISOString() : null);
  return {
    id: d.id, role: d.role, name: d.name, platform: d.platform, model: d.model, appVersion: d.app_version,
    smsPermission: d.sms_permission, queuePending: d.queue_pending, queueFailed: d.queue_failed, lastError: d.last_error,
    createdAt: at(d.created_at), lastSeenAt: at(d.last_seen_at), lastUploadAt: at(d.last_upload_at), revokedAt: at(d.revoked_at),
    current: d.id === currentId,
  };
}
function serializeNumber(n: any) {
  return {
    id: n.id, msisdn: n.msisdn, displayName: n.display_name, verificationStatus: n.verification_status,
    sourceDeviceId: n.source_device_id, simSubscriptionId: n.sim_subscription_id, simSlot: n.sim_slot, simLabel: n.sim_label,
    createdAt: new Date(n.created_at).toISOString(),
  };
}
const serializeAccount = (a: any) => ({ id: a.id, displayName: a.display_name, loginPhone: a.login_phone, timezone: a.timezone, createdAt: new Date(a.created_at).toISOString() });

export async function buildApp(config: Config, db: Db, hub: ChangeHub | null): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    logger: {
      level: config.logLevel,
      // Never log SMS text, phone numbers, tokens or amounts: no bodies, no query strings, no auth headers.
      serializers: {
        req: (req: any) => ({ method: req.method, url: String(req.url).split('?')[0], id: req.id }),
        res: (res: any) => ({ statusCode: res.statusCode }),
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: () => randomUUID(),
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Toosh-Client'],
    credentials: false,
  });
  await app.register(rateLimit, { max: config.rateLimit, timeWindow: '1 minute' });

  app.setErrorHandler((error: any, req, reply) => {
    if (error instanceof ApiError) return reply.status(error.status).send({ error: error.code, message: error.message, details: error.details });
    if (error.statusCode === 429) return reply.status(429).send({ error: 'RATE_LIMITED', message: 'Isku day mar dambe.' });
    if (error.validation || error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 415) {
      return reply.status(error.statusCode ?? 400).send({ error: 'BAD_REQUEST', message: 'Codsi aan sax ahayn.' });
    }
    req.log.error({ err: { message: error.message, code: error.code } }, 'request failed');
    return reply.status(503).send({ error: 'UNAVAILABLE', message: 'Adeeggu hadda ma shaqeynayo. Isku day mar kale.' });
  });

  // -------------------------------------------------------------------------------------------------------------
  // Authentication: bearer token (Android app) or HttpOnly cookie (browser served by this server).
  // -------------------------------------------------------------------------------------------------------------
  async function authenticate(req: FastifyRequest): Promise<AuthContext> {
    const header = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const token = header ?? req.cookies?.[SESSION_COOKIE];
    if (!token || !isTokenShaped(token)) throw new ApiError(401, 'UNAUTHENTICATED', 'Fadlan gal akoonkaaga.');
    const viaCookie = !header;
    if (viaCookie && req.method !== 'GET' && req.headers['x-toosh-client'] !== 'web') throw new ApiError(403, 'CSRF', 'Codsi aan la oggolayn.');
    const hash = sha256(token);
    const ctx = await inTx(db, { 'app.token_hash': hash }, async tx => {
      const { rows } = await tx.query('SELECT * FROM devices WHERE token_hash = $1 AND revoked_at IS NULL', [hash]);
      const d = rows[0];
      if (!d) return null;
      await tx.query('SELECT set_config($1, $2, true)', ['app.account_id', d.account_id]);
      const { rows: acc } = await tx.query('SELECT timezone FROM accounts WHERE id = $1', [d.account_id]);
      if (!d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 60000) {
        await tx.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [d.id]);
      }
      return { accountId: d.account_id, deviceId: d.id, deviceName: d.name, role: d.role, platform: d.platform, timezone: acc[0]?.timezone ?? DEFAULT_TIMEZONE, viaCookie };
    });
    if (!ctx) throw new ApiError(401, 'UNAUTHENTICATED', 'Aaladdan waa laga saaray akoonka ama fadhigu wuu dhacay. Fadlan dib u gal.');
    return ctx;
  }
  const authed = async (req: FastifyRequest) => { req.auth = await authenticate(req); };
  const A = (req: FastifyRequest) => req.auth!;
  const scoped = <T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>) => withAccount(db, A(req).accountId, fn);

  function issueSession(reply: FastifyReply, platform: string, token: string) {
    if (platform === 'web') {
      reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 180 });
      return null; // browsers never see the token
    }
    return token;
  }

  async function createDevice(tx: Tx, accountId: string, info: ReturnType<typeof deviceInfo>, role: 'SOURCE' | 'VIEWER') {
    const { token, hash } = newDeviceToken();
    const id = randomUUID();
    const { rows } = await tx.query(`INSERT INTO devices (id, account_id, role, name, platform, model, app_version, token_hash, sms_permission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, accountId, role, info.name, info.platform, info.model, info.appVersion, hash, info.platform === 'android' ? 'UNKNOWN' : 'NOT_APPLICABLE']);
    return { device: rows[0], token };
  }

  async function sessionPayload(tx: Tx, accountId: string, deviceId: string) {
    const account = (await tx.query('SELECT * FROM accounts WHERE id = $1', [accountId])).rows[0];
    const numbers = (await tx.query('SELECT * FROM evc_numbers WHERE account_id = $1 ORDER BY created_at', [accountId])).rows;
    const devices = (await tx.query('SELECT * FROM devices WHERE account_id = $1 ORDER BY created_at', [accountId])).rows;
    return {
      account: serializeAccount(account), device: serializeDevice(devices.find(d => d.id === deviceId), deviceId),
      evcNumbers: numbers.map(serializeNumber), devices: devices.filter(d => !d.revoked_at).map(d => serializeDevice(d, deviceId)),
    };
  }

  const authLimit = { config: { rateLimit: { max: config.authRateLimit, timeWindow: '1 minute' } } };

  app.get('/api/v1/health', async (req) => {
    const out: Record<string, unknown> = { ok: true, live: hub !== null };
    if ((req.query as any)?.db === '1') {
      try { await db.query('SELECT 1'); out.database = 'ok'; } catch { out.ok = false; out.database = 'unreachable'; }
    }
    return out;
  });

  /** Latest change number for this account; serverless hosts poll this instead of holding an event stream open. */
  app.get('/api/v1/changes', { preHandler: authed }, async req => scoped(req, async tx => {
    const { rows } = await tx.query(`SELECT greatest(
        (SELECT coalesce(max(change_seq), 0) FROM messages WHERE account_id = $1),
        (SELECT coalesce(max(change_seq), 0) FROM devices WHERE account_id = $1),
        (SELECT coalesce(max(change_seq), 0) FROM evc_numbers WHERE account_id = $1),
        (SELECT coalesce(max(change_seq), 0) FROM expenses WHERE account_id = $1),
        (SELECT coalesce(max(change_seq), 0) FROM expense_categories WHERE account_id = $1),
        (SELECT coalesce(max(change_seq), 0) FROM transaction_categories WHERE account_id = $1),
        (SELECT coalesce(max(change_seq), 0) FROM budgets WHERE account_id = $1),
        (SELECT coalesce(max(change_seq), 0) FROM savings_goals WHERE account_id = $1))::text AS seq`, [A(req).accountId]);
    return { seq: rows[0].seq };
  }));

  app.post('/api/v1/auth/register', authLimit, async (req, reply) => {
    const body: any = req.body ?? {};
    const errors: Record<string, string> = {};
    const displayName = shortText(body.displayName, 120);
    if (!displayName) errors.displayName = 'Geli magacaaga buuxa.';
    const phone = normalizeSomaliMsisdn(body.phone ?? '');
    if (!phone.ok) errors.phone = 'Geli lambar EVC Plus oo sax ah (sida 61 512 3456).';
    const pw = validatePassword(body.password);
    if (pw) errors.password = pw;
    const evcDisplayName = body.evcDisplayName === undefined || body.evcDisplayName === null || body.evcDisplayName === '' ? null : shortText(body.evcDisplayName, 80);
    if (Object.keys(errors).length) throw new ApiError(400, 'VALIDATION', 'Hubi xogta foomka.', errors);
    const info = deviceInfo(body.device);
    const accountId = randomUUID();
    const passwordHash = await hashPassword(body.password);
    try {
      const result = await withAccount(db, accountId, async tx => {
        await tx.query('INSERT INTO accounts (id, display_name, login_phone, password_hash) VALUES ($1,$2,$3,$4)', [accountId, displayName, (phone as any).e164, passwordHash]);
        await tx.query('INSERT INTO evc_numbers (id, account_id, msisdn, display_name) VALUES ($1,$2,$3,$4)', [randomUUID(), accountId, (phone as any).e164, evcDisplayName ?? displayName]);
        const { device, token } = await createDevice(tx, accountId, info, 'VIEWER');
        return { token, payload: await sessionPayload(tx, accountId, device.id) };
      });
      return reply.status(201).send({ token: issueSession(reply, info.platform, result.token), ...result.payload });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, 'PHONE_TAKEN', 'Lambarkan akoon ayaa horay loogu sameeyay. Isticmaal "Gal Akoonka".', { phone: 'Lambarkan horay ayaa loo diiwaangeliyay.' });
      throw e;
    }
  });

  app.post('/api/v1/auth/login', authLimit, async (req, reply) => {
    const body: any = req.body ?? {};
    const phone = normalizeSomaliMsisdn(body.phone ?? '');
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const fail = () => new ApiError(401, 'INVALID_LOGIN', 'Lambarka ama furaha sirta ah waa khalad.');
    if (!phone.ok || !password) { await verifyPassword('x', DUMMY_HASH); throw fail(); }
    const account = await inTx(db, { 'app.login_phone': phone.e164 }, async tx => (await tx.query('SELECT * FROM accounts WHERE login_phone = $1', [phone.e164])).rows[0]);
    if (!account) { await verifyPassword(password, DUMMY_HASH); throw fail(); }
    if (account.locked_until && new Date(account.locked_until) > new Date()) throw new ApiError(429, 'LOCKED', 'Isku dayo badan. Sug 15 daqiiqo kadib isku day.');
    const ok = await verifyPassword(password, account.password_hash);
    const info = deviceInfo(body.device);
    const result = await withAccount(db, account.id, async tx => {
      if (!ok) {
        await tx.query(`UPDATE accounts SET failed_logins = failed_logins + 1,
          locked_until = CASE WHEN failed_logins + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`, [account.id]);
        return null;
      }
      await tx.query('UPDATE accounts SET failed_logins = 0, locked_until = NULL WHERE id = $1', [account.id]);
      const { device, token } = await createDevice(tx, account.id, info, 'VIEWER');
      await notifyAccount(tx, account.id);
      return { token, payload: await sessionPayload(tx, account.id, device.id) };
    });
    if (!result) throw fail();
    return reply.send({ token: issueSession(reply, info.platform, result.token), ...result.payload });
  });

  /** A viewing device joins with a one-time code shown on a signed-in device. */
  app.post('/api/v1/auth/pair', authLimit, async (req, reply) => {
    const body: any = req.body ?? {};
    const hash = pairingHash(body.code);
    const bad = new ApiError(401, 'INVALID_CODE', 'Koodku waa khalad ama wuu dhacay.');
    if (!hash) throw bad;
    const info = deviceInfo(body.device);
    const result = await inTx(db, { 'app.pairing_hash': hash }, async tx => {
      const { rows } = await tx.query('SELECT * FROM pairing_codes WHERE code_hash = $1 FOR UPDATE', [hash]);
      const code = rows[0];
      if (!code || code.used_at || new Date(code.expires_at) < new Date()) return null;
      await tx.query('SELECT set_config($1, $2, true)', ['app.account_id', code.account_id]);
      const { device, token } = await createDevice(tx, code.account_id, info, 'VIEWER');
      await tx.query('UPDATE pairing_codes SET used_at = now(), used_by = $2 WHERE code_hash = $1', [hash, device.id]);
      await notifyAccount(tx, code.account_id);
      return { token, payload: await sessionPayload(tx, code.account_id, device.id) };
    });
    if (!result) throw bad;
    return reply.send({ token: issueSession(reply, info.platform, result.token), ...result.payload });
  });

  app.post('/api/v1/auth/logout', { preHandler: authed }, async (req, reply) => {
    await scoped(req, async tx => {
      await tx.query('UPDATE devices SET revoked_at = now(), revoked_by = $2, change_seq = nextval(\'change_seq\') WHERE id = $1', [A(req).deviceId, A(req).deviceId]);
      await tx.query('UPDATE evc_numbers SET source_device_id = NULL, change_seq = nextval(\'change_seq\') WHERE source_device_id = $1', [A(req).deviceId]);
      await notifyAccount(tx, A(req).accountId);
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/me', { preHandler: authed }, async req => scoped(req, tx => sessionPayload(tx, A(req).accountId, A(req).deviceId)));

  // -------------------------------------------------------------------------------------------------------------
  // Profile, password and recovery codes.
  // -------------------------------------------------------------------------------------------------------------
  const LOCKED = () => new ApiError(429, 'LOCKED', 'Isku dayo badan. Sug 15 daqiiqo kadib isku day.');
  const countFailure = (tx: Tx, accountId: string) => tx.query(`UPDATE accounts SET failed_logins = failed_logins + 1,
    locked_until = CASE WHEN failed_logins + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`, [accountId]);
  /** Checks the signed-in person's current password; wrong guesses count towards the same lockout as sign-in. */
  async function confirmPassword(req: FastifyRequest, password: unknown) {
    const account = await scoped(req, async tx => (await tx.query('SELECT password_hash, locked_until FROM accounts WHERE id = $1', [A(req).accountId])).rows[0]);
    if (account.locked_until && new Date(account.locked_until) > new Date()) throw LOCKED();
    const ok = typeof password === 'string' && password.length <= 200 && await verifyPassword(password, account.password_hash);
    await scoped(req, tx => ok ? tx.query('UPDATE accounts SET failed_logins = 0 WHERE id = $1', [A(req).accountId]) : countFailure(tx, A(req).accountId));
    if (!ok) throw new ApiError(400, 'VALIDATION', 'Furaha sirta ah ee hadda waa khalad.', { currentPassword: 'Furaha sirta ah ee hadda waa khalad.' });
  }
  /** After a password change or recovery, other viewing devices are signed out; SMS-reading phones stay connected. */
  async function signOutOtherViewers(tx: Tx, accountId: string, keepDeviceId: string) {
    const { rowCount } = await tx.query(`UPDATE devices SET revoked_at = now(), revoked_by = $2, change_seq = nextval('change_seq')
      WHERE account_id = $1 AND id <> $2 AND role = 'VIEWER' AND revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM evc_numbers n WHERE n.source_device_id = devices.id)`, [accountId, keepDeviceId]);
    return rowCount ?? 0;
  }
  const bumpDevice = (tx: Tx, deviceId: string) => tx.query(`UPDATE devices SET change_seq = nextval('change_seq') WHERE id = $1`, [deviceId]);

  app.patch('/api/v1/me', { preHandler: authed }, async req => scoped(req, async tx => {
    const body: any = req.body ?? {};
    const displayName = shortText(body.displayName, 120);
    if (!displayName) throw new ApiError(400, 'VALIDATION', 'Hubi xogta foomka.', { displayName: 'Geli magacaaga (ilaa 120 xaraf).' });
    await tx.query('UPDATE accounts SET display_name = $2 WHERE id = $1', [A(req).accountId, displayName]);
    await bumpDevice(tx, A(req).deviceId);
    await notifyAccount(tx, A(req).accountId);
    return sessionPayload(tx, A(req).accountId, A(req).deviceId);
  }));

  app.post('/api/v1/auth/password', { preHandler: authed, ...authLimit }, async req => {
    const body: any = req.body ?? {};
    const pw = validatePassword(body.newPassword);
    if (pw) throw new ApiError(400, 'VALIDATION', 'Hubi xogta foomka.', { newPassword: pw });
    if (body.newPassword === body.currentPassword) throw new ApiError(400, 'VALIDATION', 'Hubi xogta foomka.', { newPassword: 'Dooro furo ka duwan kan hadda.' });
    await confirmPassword(req, body.currentPassword);
    const hash = await hashPassword(body.newPassword);
    return scoped(req, async tx => {
      await tx.query('UPDATE accounts SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [A(req).accountId, hash]);
      const signedOut = await signOutOtherViewers(tx, A(req).accountId, A(req).deviceId);
      await notifyAccount(tx, A(req).accountId);
      return { ok: true, signedOutDevices: signedOut };
    });
  });

  app.get('/api/v1/auth/recovery-codes', { preHandler: authed }, async req => scoped(req, async tx => {
    const { rows } = await tx.query(`SELECT count(*)::int AS remaining, max(created_at) AS created_at FROM recovery_codes
      WHERE account_id = $1 AND used_at IS NULL AND replaced_at IS NULL`, [A(req).accountId]);
    return { remaining: rows[0].remaining, createdAt: rows[0].created_at ? new Date(rows[0].created_at).toISOString() : null };
  }));

  /** New set of codes (needs the password again). Older unused codes stop working. The codes are returned once. */
  app.post('/api/v1/auth/recovery-codes', { preHandler: authed, ...authLimit }, async req => {
    const body: any = req.body ?? {};
    await confirmPassword(req, body.password);
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(codes.map(c => hashPassword(normalizeRecoveryCode(c)!)));
    await scoped(req, async tx => {
      await tx.query('UPDATE recovery_codes SET replaced_at = now() WHERE account_id = $1 AND used_at IS NULL AND replaced_at IS NULL', [A(req).accountId]);
      for (const h of hashes) await tx.query('INSERT INTO recovery_codes (id, account_id, code_hash) VALUES ($1,$2,$3)', [randomUUID(), A(req).accountId, h]);
    });
    return { codes };
  });

  /** Forgotten password: phone number + one unused recovery code + a new password. Signs this device in. */
  app.post('/api/v1/auth/recover', authLimit, async (req, reply) => {
    const body: any = req.body ?? {};
    const phone = normalizeSomaliMsisdn(body.phone ?? '');
    const code = normalizeRecoveryCode(body.code);
    const pw = validatePassword(body.newPassword);
    if (pw) throw new ApiError(400, 'VALIDATION', 'Hubi xogta foomka.', { newPassword: pw });
    const fail = () => new ApiError(401, 'INVALID_RECOVERY', 'Lambarka ama koodhka soo celinta waa khalad, ama koodhka hore ayaa loo isticmaalay.');
    if (!phone.ok || !code) { await verifyPassword('x', DUMMY_HASH); throw fail(); }
    const account = await inTx(db, { 'app.login_phone': phone.e164 }, async tx => (await tx.query('SELECT id, locked_until FROM accounts WHERE login_phone = $1', [phone.e164])).rows[0]);
    if (!account) { await verifyPassword(code, DUMMY_HASH); throw fail(); }
    if (account.locked_until && new Date(account.locked_until) > new Date()) throw LOCKED();
    const candidates = await withAccount(db, account.id, async tx => (await tx.query(
      'SELECT id, code_hash FROM recovery_codes WHERE account_id = $1 AND used_at IS NULL AND replaced_at IS NULL', [account.id])).rows);
    let matched: string | null = null;
    for (const c of candidates) if (await verifyPassword(code, c.code_hash)) { matched = c.id; break; }
    if (!candidates.length) await verifyPassword(code, DUMMY_HASH);
    const info = deviceInfo(body.device);
    const newHash = matched ? await hashPassword(body.newPassword) : null;
    const result = await withAccount(db, account.id, async tx => {
      if (!matched) { await countFailure(tx, account.id); return null; }
      // Mark the code used first; a second request racing with the same code finds nothing to update.
      const used = await tx.query('UPDATE recovery_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL AND replaced_at IS NULL', [matched]);
      if (!used.rowCount) return null;
      await tx.query('UPDATE accounts SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [account.id, newHash]);
      const { device, token } = await createDevice(tx, account.id, info, 'VIEWER');
      await tx.query('UPDATE recovery_codes SET used_by_device_id = $2 WHERE id = $1', [matched, device.id]);
      await signOutOtherViewers(tx, account.id, device.id);
      await notifyAccount(tx, account.id);
      const left = (await tx.query('SELECT count(*)::int AS n FROM recovery_codes WHERE account_id = $1 AND used_at IS NULL AND replaced_at IS NULL', [account.id])).rows[0].n;
      return { token, left, payload: await sessionPayload(tx, account.id, device.id) };
    });
    if (!result) throw fail();
    return reply.send({ token: issueSession(reply, info.platform, result.token), recoveryCodesRemaining: result.left, ...result.payload });
  });

  // -------------------------------------------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------------------------------------------
  app.post('/api/v1/devices/pairing-code', { preHandler: authed }, async req => scoped(req, async tx => {
    const { code, hash } = newPairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60000);
    await tx.query('INSERT INTO pairing_codes (code_hash, account_id, created_by, expires_at) VALUES ($1,$2,$3,$4)', [hash, A(req).accountId, A(req).deviceId, expiresAt]);
    return { code, expiresAt: expiresAt.toISOString() };
  }));

  app.delete<{ Params: { id: string } }>('/api/v1/devices/:id', { preHandler: authed }, async (req, reply) => {
    if (!UUID.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'Aaladda lama helin.');
    await scoped(req, async tx => {
      const { rowCount } = await tx.query(`UPDATE devices SET revoked_at = now(), revoked_by = $3, change_seq = nextval('change_seq')
        WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL`, [A(req).accountId, req.params.id, A(req).deviceId]);
      if (!rowCount) throw new ApiError(404, 'NOT_FOUND', 'Aaladda lama helin.');
      await tx.query(`UPDATE evc_numbers SET source_device_id = NULL, change_seq = nextval('change_seq') WHERE account_id = $1 AND source_device_id = $2`, [A(req).accountId, req.params.id]);
      await notifyAccount(tx, A(req).accountId);
    });
    if (req.params.id === A(req).deviceId) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Source phones report their state: permission, queue counts. This is "contact", not a successful data sync. */
  app.post('/api/v1/devices/me/heartbeat', { preHandler: authed }, async req => scoped(req, async tx => {
    const b: any = req.body ?? {};
    const perm = ['GRANTED', 'DENIED', 'UNKNOWN', 'NOT_APPLICABLE'].includes(b.smsPermission) ? b.smsPermission : null;
    const count = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) < 1e7 ? v : null);
    await tx.query(`UPDATE devices SET last_seen_at = now(), sms_permission = COALESCE($2, sms_permission), queue_pending = $3, queue_failed = $4,
      last_error = $5, app_version = COALESCE($6, app_version), model = COALESCE($7, model), change_seq = nextval('change_seq') WHERE id = $1`,
      [A(req).deviceId, perm, count(b.queuePending), count(b.queueFailed), shortText(b.lastError, 200), shortText(b.appVersion, 40), shortText(b.model, 80)]);
    await notifyAccount(tx, A(req).accountId);
    return { ok: true, serverTime: new Date().toISOString() };
  }));

  // -------------------------------------------------------------------------------------------------------------
  // EVC numbers
  // -------------------------------------------------------------------------------------------------------------
  app.post('/api/v1/evc-numbers', { preHandler: authed }, async (req, reply) => {
    const b: any = req.body ?? {};
    const phone = normalizeSomaliMsisdn(b.msisdn ?? '');
    if (!phone.ok) throw new ApiError(400, 'VALIDATION', 'Hubi lambarka.', { msisdn: 'Geli lambar EVC Plus oo sax ah.' });
    const name = b.displayName ? shortText(b.displayName, 80) : null;
    try {
      const n = await scoped(req, async tx => {
        const { rows } = await tx.query('INSERT INTO evc_numbers (id, account_id, msisdn, display_name) VALUES ($1,$2,$3,$4) RETURNING *', [randomUUID(), A(req).accountId, phone.e164, name]);
        await notifyAccount(tx, A(req).accountId);
        return rows[0];
      });
      return reply.status(201).send(serializeNumber(n));
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, 'NUMBER_EXISTS', 'Lambarkan horay ayuu ugu jiraa akoonkaaga.');
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/v1/evc-numbers/:id', { preHandler: authed }, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'Lambarka lama helin.');
    const b: any = req.body ?? {};
    const name = b.displayName === null || b.displayName === '' ? null : shortText(b.displayName, 80);
    if (b.displayName && !name) throw new ApiError(400, 'VALIDATION', 'Magac aan sax ahayn.');
    const { rows } = await tx.query(`UPDATE evc_numbers SET display_name = $3, change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2 RETURNING *`, [A(req).accountId, req.params.id, name]);
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Lambarka lama helin.');
    await notifyAccount(tx, A(req).accountId);
    return serializeNumber(rows[0]);
  }));

  /**
   * Makes the calling Android phone the source of a number and records which SIM subscription receives its SMS.
   * One active source per number; replacing another source needs an explicit `replace: true`.
   */
  app.post<{ Params: { id: string } }>('/api/v1/evc-numbers/:id/source', { preHandler: authed }, async req => scoped(req, async tx => {
    if (A(req).platform !== 'android') throw new ApiError(400, 'NOT_ANDROID', 'Kaliya taleefan Android ah ayaa noqon kara taleefanka asalka ah.');
    if (!UUID.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'Lambarka lama helin.');
    const b: any = req.body ?? {};
    const sub = Number.isSafeInteger(b.simSubscriptionId) ? b.simSubscriptionId : null;
    const slot = Number.isSafeInteger(b.simSlot) && b.simSlot >= 0 && b.simSlot <= 7 ? b.simSlot : null;
    const { rows } = await tx.query('SELECT * FROM evc_numbers WHERE account_id = $1 AND id = $2 FOR UPDATE', [A(req).accountId, req.params.id]);
    const n = rows[0];
    if (!n) throw new ApiError(404, 'NOT_FOUND', 'Lambarka lama helin.');
    if (n.source_device_id && n.source_device_id !== A(req).deviceId && b.replace !== true) {
      throw new ApiError(409, 'SOURCE_EXISTS', 'Lambarkan taleefan kale ayaa horay u ahaa taleefanka asalka ah.');
    }
    if (sub !== null) {
      const clash = await tx.query('SELECT id FROM evc_numbers WHERE account_id = $1 AND source_device_id = $2 AND sim_subscription_id = $3 AND id <> $4',
        [A(req).accountId, A(req).deviceId, sub, n.id]);
      if (clash.rowCount) throw new ApiError(409, 'SIM_IN_USE', 'SIM-kan waxaa horay loogu xiray lambar kale.');
    }
    const { rows: u } = await tx.query(`UPDATE evc_numbers SET source_device_id = $3, sim_subscription_id = $4, sim_slot = $5, sim_label = $6,
      change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2 RETURNING *`, [A(req).accountId, n.id, A(req).deviceId, sub, slot, shortText(b.simLabel, 80)]);
    await tx.query(`UPDATE devices SET role = 'SOURCE', change_seq = nextval('change_seq') WHERE id = $1`, [A(req).deviceId]);
    await notifyAccount(tx, A(req).accountId);
    return serializeNumber(u[0]);
  }));

  app.delete<{ Params: { id: string } }>('/api/v1/evc-numbers/:id/source', { preHandler: authed }, async req => scoped(req, async tx => {
    if (!UUID.test(req.params.id)) throw new ApiError(404, 'NOT_FOUND', 'Lambarka lama helin.');
    const { rows } = await tx.query(`UPDATE evc_numbers SET source_device_id = NULL, sim_subscription_id = NULL, sim_slot = NULL, sim_label = NULL,
      change_seq = nextval('change_seq') WHERE account_id = $1 AND id = $2 RETURNING *`, [A(req).accountId, req.params.id]);
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Lambarka lama helin.');
    await notifyAccount(tx, A(req).accountId);
    return serializeNumber(rows[0]);
  }));

  // -------------------------------------------------------------------------------------------------------------
  // SMS ingestion (source phones only). Idempotent: retries return "duplicate" with the same message id.
  // -------------------------------------------------------------------------------------------------------------
  app.post('/api/v1/ingest/messages', { preHandler: authed, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async req => {
    const items = (req.body as any)?.messages;
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new ApiError(400, 'INVALID_BATCH', 'Send 1-100 messages per request.');
    if (A(req).platform !== 'android') throw new ApiError(403, 'NOT_SOURCE', 'Only an Android source phone can upload SMS.');
    const results = await scoped(req, tx => ingestBatch(tx, A(req), items));
    return { results, serverTime: new Date().toISOString() };
  });

  // -------------------------------------------------------------------------------------------------------------
  // Reading and classifying
  // -------------------------------------------------------------------------------------------------------------
  app.get('/api/v1/messages', { preHandler: authed }, async req => scoped(req, tx => listMessages(tx, A(req).accountId, A(req).timezone, req.query as any)));
  app.get<{ Params: { id: string } }>('/api/v1/messages/:id', { preHandler: authed }, async req => scoped(req, async tx => {
    const detail = await messageDetail(tx, A(req).accountId, req.params.id);
    const { rows } = await tx.query('SELECT category_key, custom_category_id FROM transaction_categories WHERE account_id = $1 AND message_id = $2', [A(req).accountId, req.params.id]);
    return { ...detail, category: rows[0] ? (rows[0].category_key ?? `custom:${rows[0].custom_category_id}`) : null };
  }));
  app.put<{ Params: { id: string } }>('/api/v1/messages/:id/classification', { preHandler: authed }, async req =>
    ({ message: await scoped(req, tx => classifyMessage(tx, A(req), req.params.id, req.body)) }));
  app.get('/api/v1/transactions', { preHandler: authed }, async req => scoped(req, tx => listTransactions(tx, A(req).accountId, A(req).timezone, req.query as any)));
  app.get('/api/v1/summary', { preHandler: authed }, async req => scoped(req, tx => summary(tx, A(req).accountId, A(req).timezone, req.query as any)));
  app.get('/api/v1/balances', { preHandler: authed }, async req => scoped(req, async tx => ({ balances: await latestBalances(tx, A(req).accountId) })));

  registerFinanceRoutes(app, { authed, scoped, ctx: A });

  /** Server-sent events: "something changed for this account". Clients refetch what they show. */
  app.get('/api/v1/events', { preHandler: authed }, async (req, reply) => {
    if (!hub) return reply.status(404).send({ error: 'LIVE_UNAVAILABLE', message: 'Use /api/v1/changes polling on this host.' });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': req.headers.origin && config.corsOrigins.includes(req.headers.origin) ? req.headers.origin : '' });
    res.write(`event: ready\ndata: {}\n\n`);
    const unsubscribe = hub?.subscribe(A(req).accountId, p => res.write(`event: change\ndata: ${JSON.stringify(p)}\n\n`)) ?? (() => {});
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.raw.on('close', () => { clearInterval(ping); unsubscribe(); });
  });

  // Browser viewing devices: serve the built app from the same origin (cookie sessions).
  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: true });
    // App routes fall back to index.html; API paths and missing files (anything with an extension) are real 404s.
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      if (path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return reply.status(404).send({ error: 'NOT_FOUND' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
