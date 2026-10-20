#!/usr/bin/env node
// Checks a running Toosh deployment over HTTPS: authentication, account isolation, persistence and sync between two
// clients of one account. It creates two throwaway test accounts. Usage: node scripts/check-deployment.mjs https://host
import { randomBytes } from 'node:crypto';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('usage: node scripts/check-deployment.mjs https://<host>'); process.exit(2); }

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const phone = () => `61${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const password = randomBytes(12).toString('base64url');
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const tar = `${pad(now.getUTCDate())}/${pad(now.getUTCMonth() + 1)}/${String(now.getUTCFullYear()).slice(2)} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
const sms = (numberId, body) => ({
  clientMessageId: `check-${Date.now()}-${randomBytes(4).toString('hex')}`, evcNumberId: numberId, sender: '192', body,
  smsTimestamp: now.toISOString(), receivedAt: new Date().toISOString(), simSubscriptionId: 1, simSlot: 0, importMethod: 'LIVE', partsCount: 1,
});

async function sourceAccount(name) {
  const p = phone();
  const reg = await call('POST', '/api/v1/auth/register', null, { displayName: name, phone: p, password, device: { platform: 'android', name: 'Check phone', model: 'check' } });
  if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const numberId = reg.body.evcNumbers[0].id;
  const src = await call('POST', `/api/v1/evc-numbers/${numberId}/source`, reg.body.token, { simSubscriptionId: 1, simSlot: 0, simLabel: 'SIM 1' });
  if (src.status !== 200) throw new Error(`source ${src.status}`);
  return { phone: p, token: reg.body.token, numberId };
}

const health = await call('GET', '/api/v1/health?db=1');
ok(health.status === 200 && health.body?.database === 'ok', `health with database: ${JSON.stringify(health.body)}`);
if (failures) process.exit(1);

// Authentication
const a = await sourceAccount('Check A');
ok(Boolean(a.token), 'account A registered from a phone');
ok((await call('GET', '/api/v1/me')).status === 401, 'no token -> 401');
ok((await call('GET', '/api/v1/me', 'tsh_' + 'x'.repeat(43))).status === 401, 'made-up token -> 401');
ok((await call('POST', '/api/v1/auth/login', null, { phone: a.phone, password: 'wrong password!!' })).status === 401, 'wrong password -> 401');
const login = await call('POST', '/api/v1/auth/login', null, { phone: a.phone, password, device: { platform: 'ios', name: 'Check viewer' } });
ok(login.status === 200, 'second device (viewer) signs in to account A');
const viewer = login.body?.token;

// Two-client sync: phone uploads, viewer sees it through the change counter; viewer corrects, phone sees it.
const seq = async t => BigInt((await call('GET', '/api/v1/changes', t)).body.seq);
const v0 = await seq(viewer);
const up = await call('POST', '/api/v1/ingest/messages', a.token, { messages: [
  sms(a.numberId, `[-EVCPLUS-] waxaad $3 ka heshay 615998822, Tar: ${tar} haraagagu waa $54.585.`),
  sms(a.numberId, `[-EVCPlus-] Hubi lambarka ${tar}`),
] });
ok(up.status === 200, 'phone uploads 2 SMS');
ok(await seq(viewer) > v0, 'viewer change counter rises after the phone uploads');
const page = await call('GET', '/api/v1/messages?limit=50', viewer);
ok(page.body?.counts?.all === 2, `viewer sees both messages (counts ${JSON.stringify(page.body?.counts)})`);
const pending = page.body?.items?.find?.(m => m.status === 'NEEDS_REVIEW' || m.classification === 'NEEDS_REVIEW') ?? page.body?.items?.find?.(m => m.direction == null);
if (pending) {
  const p0 = await seq(a.token);
  const fix = await call('PUT', `/api/v1/messages/${pending.id}/classification`, viewer, { classification: 'NOT_TRANSACTION', expectedVersion: pending.version });
  ok(fix.status === 200, 'viewer corrects a message');
  ok(await seq(a.token) > p0, 'phone change counter rises after the viewer edits');
} else ok(false, 'found a message needing review to correct');

// Isolation
const b = await sourceAccount('Check B');
const bPage = await call('GET', '/api/v1/messages?limit=50', b.token);
ok(bPage.body?.counts?.all === 0, 'account B sees none of A\'s messages');
ok((await call('GET', `/api/v1/messages/${page.body?.items?.[0]?.id}`, b.token)).status === 404, 'account B cannot open A\'s message by id');
ok((await call('POST', '/api/v1/ingest/messages', b.token, { messages: [sms(a.numberId, `[-EVCPLUS-] waxaad $1 ka heshay 615998822, Tar: ${tar} haraagagu waa $1.`)] })).body?.results?.[0]?.status !== 'CREATED',
  'account B cannot upload into A\'s EVC number');

// Persistence: a fresh sign-in (new connection, possibly a new function instance) still sees the stored data.
const again = await call('POST', '/api/v1/auth/login', null, { phone: a.phone, password, device: { platform: 'ios', name: 'Check later' } });
ok((await call('GET', '/api/v1/messages?limit=50', again.body?.token)).body?.counts?.all === 2, 'data is still there after a new sign-in');

// Sign-out
await call('POST', '/api/v1/auth/logout', viewer);
ok((await call('GET', '/api/v1/me', viewer)).status === 401, 'signed-out device token is refused');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
