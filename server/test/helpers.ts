import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Db } from '../src/db.ts';
import { ChangeHub } from '../src/events.ts';
import { migrate } from '../src/migrate.ts';

/**
 * Each test file gets its own database. The app connects as TEST_APP_ROLE, a normal (non-superuser, no BYPASSRLS)
 * role, so row-level security is enforced exactly as in production.
 */
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
const ROLE = process.env.TEST_APP_ROLE ?? 'toosh_test';
const ROLE_PASSWORD = process.env.TEST_APP_PASSWORD ?? 'toosh_test';

export interface TestEnv { app: FastifyInstance; db: Db; hub: ChangeHub; url: string; close: () => Promise<void> }

export async function setup(): Promise<TestEnv> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  if (!exists.rowCount) await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  const name = `toosh_test_${randomBytes(4).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name} OWNER ${ROLE}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.username = ROLE; u.password = ROLE_PASSWORD; u.pathname = `/${name}`;
  const url = u.toString();
  const db = createPool(url);
  await migrate(db);
  const hub = new ChangeHub(url);
  await hub.start();
  const app = await buildApp(loadConfig({ DATABASE_URL: url, LOG_LEVEL: 'silent', COOKIE_SECURE: 'false', AUTH_RATE_LIMIT: '10000' } as any), db, hub);
  return {
    app, db, hub, url,
    close: async () => {
      await app.close(); await hub.stop(); await db.end();
      const a = new pg.Client({ connectionString: ADMIN_URL }); await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await a.end();
    },
  };
}

let phoneCounter = 1000000;
export const nextPhone = () => `61${String(phoneCounter++).padStart(7, '0')}`;

export async function call(app: FastifyInstance, method: string, url: string, token?: string, body?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let json: any = null;
  try { json = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body: json, headers: res.headers };
}

/** Registers an account from an Android phone and makes that phone the source of the account's EVC number. */
export async function sourceAccount(app: FastifyInstance, opts: { sim?: number | null } = {}) {
  const phone = nextPhone();
  const reg = await call(app, 'POST', '/api/v1/auth/register', undefined, {
    displayName: 'Axmed Nuur Cali', phone, password: 'correct horse battery', device: { name: 'Samsung Galaxy A54', platform: 'android', model: 'SM-A546E' },
  });
  if (reg.status !== 201) throw new Error(`register failed ${reg.status} ${JSON.stringify(reg.body)}`);
  const token = reg.body.token as string;
  const number = reg.body.evcNumbers[0];
  const src = await call(app, 'POST', `/api/v1/evc-numbers/${number.id}/source`, token, { simSubscriptionId: opts.sim === undefined ? 1 : opts.sim, simSlot: 0, simLabel: 'SIM 1 · Hormuud' });
  if (src.status !== 200) throw new Error(`source failed ${src.status} ${JSON.stringify(src.body)}`);
  return { token, phone, numberId: number.id as string, accountId: reg.body.account.id as string, deviceId: reg.body.device.id as string };
}

export async function viewerLogin(app: FastifyInstance, phone: string, platform = 'web') {
  const res = await call(app, 'POST', '/api/v1/auth/login', undefined, { phone, password: 'correct horse battery', device: { name: 'Viewer', platform: platform === 'web' ? 'ios' : platform } });
  if (res.status !== 200) throw new Error(`login failed ${res.status}`);
  return res.body.token as string;
}

let smsCounter = 0;
/** An ingest item as the Android app sends it. */
export function sms(numberId: string, body: string, at: string, extra: Record<string, unknown> = {}) {
  smsCounter++;
  return {
    clientMessageId: `live-${Date.parse(at)}-${smsCounter}-${randomBytes(3).toString('hex')}`, evcNumberId: numberId, sender: '192', body,
    smsTimestamp: at, receivedAt: new Date(Date.parse(at) + 2000).toISOString(), simSubscriptionId: 1, simSlot: 0, importMethod: 'LIVE', partsCount: 1, ...extra,
  };
}

export async function ingest(app: FastifyInstance, token: string, items: unknown[]) {
  const res = await call(app, 'POST', '/api/v1/ingest/messages', token, { messages: items });
  if (res.status !== 200) throw new Error(`ingest failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.results as any[];
}

export const OUT_SMS = (amount = '3.90', balance = '51.59', time = '19/10/26 18:40:41') =>
  `[-EVCPlus-] $${amount} ayaad uwareejisay Qof Tusaale(615551288), Tar: ${time} Haraagaagu waa $${balance}.`;
export const IN_SMS = (amount = '3', balance = '54.585', time = '19/10/26 18:40:41') =>
  `[-EVCPLUS-] waxaad $${amount} ka heshay 615998822, Tar: ${time} haraagagu waa $${balance}.`;
