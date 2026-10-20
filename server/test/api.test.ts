import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withAccount } from '../src/db.ts';
import { reprocessMessage } from '../src/messages.ts';
import { call, IN_SMS, ingest, nextPhone, OUT_SMS, setup, sms, sourceAccount, viewerLogin, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const DAY = '?period=custom&from=2026-10-19&to=2026-10-19';
const T = (hhmmss: string) => `2026-10-19T${hhmmss}Z`; // UTC; Mogadishu is +3

describe('authentication and sessions', () => {
  test('register, login, session, logout and revoked tokens', async () => {
    const phone = nextPhone();
    const reg = await call(env.app, 'POST', '/api/v1/auth/register', undefined, { displayName: 'Axmed', phone: `0${phone}`, password: 'long enough pw', device: { platform: 'android', name: 'Pixel' } });
    assert.equal(reg.status, 201);
    assert.match(reg.body.token, /^tsh_/);
    assert.equal(reg.body.account.loginPhone, `+252${phone}`);
    assert.equal(reg.body.evcNumbers[0].msisdn, `+252${phone}`);
    assert.equal(reg.body.evcNumbers[0].verificationStatus, 'UNVERIFIED', 'registering a number never marks it verified');

    assert.equal((await call(env.app, 'POST', '/api/v1/auth/register', undefined, { displayName: 'X', phone, password: 'long enough pw' })).status, 409);
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/register', undefined, { displayName: 'X', phone: '123', password: 'short' })).status, 400);
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/login', undefined, { phone, password: 'wrong password' })).status, 401);
    const login = await call(env.app, 'POST', '/api/v1/auth/login', undefined, { phone: `+252 ${phone}`, password: 'long enough pw', device: { platform: 'ios', name: 'iPhone' } });
    assert.equal(login.status, 200);
    const me = await call(env.app, 'GET', '/api/v1/me', login.body.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.devices.length, 2);
    assert.equal(me.body.device.role, 'VIEWER');

    assert.equal((await call(env.app, 'POST', '/api/v1/auth/logout', login.body.token)).status, 200);
    assert.equal((await call(env.app, 'GET', '/api/v1/me', login.body.token)).status, 401);
    assert.equal((await call(env.app, 'GET', '/api/v1/me')).status, 401);
    assert.equal((await call(env.app, 'GET', '/api/v1/me', 'tsh_' + 'a'.repeat(43))).status, 401);
  });

  test('browsers get an HttpOnly cookie, never the token; cookie writes need the client header', async () => {
    const phone = nextPhone();
    const reg = await call(env.app, 'POST', '/api/v1/auth/register', undefined, { displayName: 'Web', phone, password: 'long enough pw', device: { platform: 'web', name: 'MacBook Air (Web)' } });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.token, null);
    const setCookie = String(reg.headers['set-cookie']);
    assert.match(setCookie, /toosh_session=tsh_/); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    const me = await env.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    assert.equal(me.statusCode, 200);
    const forged = await env.app.inject({ method: 'POST', url: '/api/v1/devices/pairing-code', headers: { cookie } });
    assert.equal(forged.statusCode, 403, 'cookie-authenticated writes without X-Toosh-Client are refused (CSRF)');
    const ok = await env.app.inject({ method: 'POST', url: '/api/v1/devices/pairing-code', headers: { cookie, 'x-toosh-client': 'web' } });
    assert.equal(ok.statusCode, 200);
  });

  test('a viewing device joins with a one-time pairing code; the owner can revoke it', async () => {
    const a = await sourceAccount(env.app);
    const code = (await call(env.app, 'POST', '/api/v1/devices/pairing-code', a.token)).body.code;
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const pair = await call(env.app, 'POST', '/api/v1/auth/pair', undefined, { code: code.toLowerCase(), device: { platform: 'ios', name: 'iPhone 14 Pro' } });
    assert.equal(pair.status, 200);
    assert.equal(pair.body.account.id, a.accountId);
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/pair', undefined, { code })).status, 401, 'codes are single use');
    const viewerId = pair.body.device.id;
    assert.equal((await call(env.app, 'DELETE', `/api/v1/devices/${viewerId}`, a.token)).status, 200);
    assert.equal((await call(env.app, 'GET', '/api/v1/me', pair.body.token)).status, 401, 'revoked device is signed out');
  });

  test('repeated wrong passwords lock the account for a while', async () => {
    const a = await sourceAccount(env.app);
    for (let i = 0; i < 10; i++) await env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { phone: a.phone, password: 'nope nope nope' }, remoteAddress: `10.0.${i}.1` });
    const res = await env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { phone: a.phone, password: 'correct horse battery' }, remoteAddress: '10.9.9.9' });
    assert.equal(res.statusCode, 429);
  });
});

describe('account isolation', () => {
  test('one account can never see or change another account\'s data', async () => {
    const a = await sourceAccount(env.app);
    const b = await sourceAccount(env.app);
    const [res] = await ingest(env.app, a.token, [sms(a.numberId, OUT_SMS(), T('15:40:45'))]);
    const id = res.messageId;
    assert.equal((await call(env.app, 'GET', `/api/v1/messages/${id}`, b.token)).status, 404);
    assert.equal((await call(env.app, 'GET', '/api/v1/messages', b.token)).body.items.length, 0);
    assert.equal((await call(env.app, 'PUT', `/api/v1/messages/${id}/classification`, b.token, { classification: 'NOT_TRANSACTION', expectedVersion: 1 })).status, 404);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/devices/${a.deviceId}`, b.token)).status, 404);
    assert.equal((await call(env.app, 'POST', `/api/v1/evc-numbers/${a.numberId}/source`, b.token, {})).status, 404);
    const [cross] = await ingest(env.app, b.token, [sms(a.numberId, IN_SMS(), T('15:40:46'))]);
    assert.deepEqual([cross.status, cross.code], ['rejected', 'NOT_SOURCE_FOR_NUMBER']);
    const bSummary = (await call(env.app, 'GET', `/api/v1/summary${DAY}`, b.token)).body;
    assert.equal(bSummary.outgoing.total, '0.00');
    assert.equal(bSummary.balances.length, 0);

    // Row-level security holds even for a query with no account filter at all.
    const leaked = await withAccount(env.db, b.accountId, async tx => (await tx.query('SELECT count(*)::int AS n FROM messages')).rows[0].n);
    assert.equal(leaked, 0);
    const none = (await env.db.query('SELECT count(*)::int AS n FROM messages')).rows[0].n;
    assert.equal(none, 0, 'without an account context nothing is visible');
  });
});

describe('SMS ingestion', () => {
  test('retries and re-imports of the same SMS never create duplicates', async () => {
    const a = await sourceAccount(env.app);
    const item = sms(a.numberId, IN_SMS(), T('15:40:45'));
    const [first] = await ingest(env.app, a.token, [item]);
    assert.equal(first.status, 'created');
    assert.equal(first.classification, 'TRANSACTION');
    const [retry] = await ingest(env.app, a.token, [item]);
    assert.deepEqual([retry.status, retry.messageId], ['duplicate', first.messageId]);
    // The same SMS found again by the initial inbox import (different import id).
    const [reimport] = await ingest(env.app, a.token, [{ ...item, clientMessageId: 'import-xyz-123', importMethod: 'INITIAL_IMPORT' }]);
    assert.deepEqual([reimport.status, reimport.messageId], ['duplicate', first.messageId]);
    // Concurrent retries.
    const again = sms(a.numberId, OUT_SMS(), T('15:41:00'));
    const parallel = await Promise.all([1, 2, 3, 4].map(() => ingest(env.app, a.token, [again])));
    assert.equal(parallel.flat().filter(r => r.status === 'created').length, 1);
    assert.equal(new Set(parallel.flat().map(r => r.messageId)).size, 1);
    const totals = (await call(env.app, 'GET', `/api/v1/summary${DAY}`, a.token)).body;
    assert.deepEqual([totals.incoming.total, totals.incoming.count, totals.outgoing.count], ['3.00', 1, 1]);
  });

  test('two real payments with the same amount and time are both kept', async () => {
    const a = await sourceAccount(env.app);
    const body = IN_SMS('5', '10');
    const results = await ingest(env.app, a.token, [sms(a.numberId, body, '2026-10-19T15:40:45.120Z'), sms(a.numberId, body, '2026-10-19T15:40:45.900Z')]);
    assert.deepEqual(results.map(r => r.status), ['created', 'created']);
    const totals = (await call(env.app, 'GET', `/api/v1/summary${DAY}`, a.token)).body;
    assert.deepEqual([totals.incoming.total, totals.incoming.count], ['10.00', 2]);
  });

  test('a reused import id with different content is rejected, not merged', async () => {
    const a = await sourceAccount(env.app);
    const item = sms(a.numberId, IN_SMS(), T('15:40:45'));
    await ingest(env.app, a.token, [item]);
    const [res] = await ingest(env.app, a.token, [{ ...item, body: IN_SMS('9') }]);
    assert.deepEqual([res.status, res.code], ['rejected', 'CLIENT_ID_REUSED']);
  });

  test('only the source phone of a number, on its SIM, can upload EVC messages', async () => {
    const a = await sourceAccount(env.app);
    const viewer = await viewerLogin(env.app, a.phone, 'android');
    const [notSource] = await ingest(env.app, viewer, [sms(a.numberId, IN_SMS(), T('15:40:45'))]);
    assert.equal(notSource.code, 'NOT_SOURCE_FOR_NUMBER');
    const [sim] = await ingest(env.app, a.token, [sms(a.numberId, IN_SMS(), T('15:40:45'), { simSubscriptionId: 2 })]);
    assert.equal(sim.code, 'SIM_MISMATCH', 'messages from the other SIM are never mixed into this number');
    const [otp] = await ingest(env.app, a.token, [sms(a.numberId, 'Your OTP is 1234', T('15:40:45'))]);
    assert.equal(otp.code, 'NOT_EVC_MESSAGE');
    const [future] = await ingest(env.app, a.token, [sms(a.numberId, IN_SMS(), '2099-01-01T00:00:00Z')]);
    assert.equal(future.code, 'INVALID_TIME');
    const webViewer = await call(env.app, 'POST', '/api/v1/auth/login', undefined, { phone: a.phone, password: 'correct horse battery', device: { platform: 'web' } });
    const cookie = String(webViewer.headers['set-cookie']).split(';')[0];
    const web = await env.app.inject({ method: 'POST', url: '/api/v1/ingest/messages', headers: { cookie, 'x-toosh-client': 'web' }, payload: { messages: [sms(a.numberId, IN_SMS(), T('15:40:45'))] } });
    assert.equal(web.statusCode, 403);
  });

  test('ambiguous messages wait for review and stay out of totals', async () => {
    const a = await sourceAccount(env.app);
    const results = await ingest(env.app, a.token, [
      sms(a.numberId, '[-EVCPlus-] $15.00 waxaad u dirtay 615998822 Tariikh: 19/10/26 18:20:15.', T('15:20:20')),
      sms(a.numberId, '[-EVCPlus-] Haraagaagu waa $40', T('15:30:00')),
      sms(a.numberId, OUT_SMS('2'), T('15:40:45')),
    ]);
    assert.deepEqual(results.map(r => r.classification), ['PENDING', 'NOT_TRANSACTION', 'TRANSACTION']);
    const s = (await call(env.app, 'GET', `/api/v1/summary${DAY}`, a.token)).body;
    assert.deepEqual([s.outgoing.total, s.outgoing.count, s.incoming.count, s.pendingCount], ['2.00', 1, 0, 1]);
    const inbox = (await call(env.app, 'GET', '/api/v1/messages?filter=pending', a.token)).body;
    assert.equal(inbox.items.length, 1);
    assert.deepEqual(inbox.counts, { all: 3, in: 0, out: 1, pending: 1, ignored: 1 });
    assert.equal(inbox.items[0].body, '[-EVCPlus-] $15.00 waxaad u dirtay 615998822 Tariikh: 19/10/26 18:20:15.');
  });

  test('a repeated provider reference never becomes a second transaction', async () => {
    const a = await sourceAccount(env.app);
    const body = (amt: string) => `[-EVCPlus-] $${amt} ayaad uwareejisay Ali (615551288), Ref: TX-1001, Tar: 19/10/26 18:40:41 Haraagaagu waa $1`;
    const r = await ingest(env.app, a.token, [sms(a.numberId, body('7'), T('15:40:45')), sms(a.numberId, body('7'), T('15:45:00'))]);
    assert.deepEqual(r.map(x => x.classification), ['TRANSACTION', 'PENDING']);
    const pending = (await call(env.app, 'GET', `/api/v1/messages/${r[1].messageId}`, a.token)).body.message;
    assert.deepEqual(pending.parsed.reviewReasons, ['DUPLICATE_REFERENCE']);
  });
});

describe('manual classification and corrections', () => {
  test('classify, correct, reclassify: totals, audit trail and original SMS', async () => {
    const a = await sourceAccount(env.app);
    const odd = '[-EVCPlus-] $15.00 waxaad u dirtay 615998822 Haraagaagu waa $36.59.';
    const [p] = await ingest(env.app, a.token, [sms(a.numberId, odd, T('08:20:15'))]);
    const detail = (await call(env.app, 'GET', `/api/v1/messages/${p.messageId}`, a.token)).body.message;
    assert.equal(detail.classification, 'PENDING');
    assert.equal(detail.balance.eligible, false, 'a pending message never supplies the balance');

    const viewer = await viewerLogin(env.app, a.phone, 'ios');
    const missing = await call(env.app, 'PUT', `/api/v1/messages/${p.messageId}/classification`, viewer, { classification: 'TRANSACTION', expectedVersion: 1, direction: 'OUT' });
    assert.equal(missing.status, 400);
    assert.ok(missing.body.details.amount);

    const save = await call(env.app, 'PUT', `/api/v1/messages/${p.messageId}/classification`, viewer, {
      classification: 'TRANSACTION', expectedVersion: 1, direction: 'OUT', amount: '15.00', counterpartyName: 'Faarax Axmed Geedi', counterpartyPhone: '+252 61 599 8822', balance: '36.59',
    });
    assert.equal(save.status, 200);
    const m = save.body.message;
    assert.deepEqual([m.classification, m.classificationSource, m.version], ['TRANSACTION', 'MANUAL', 2]);
    assert.equal(m.transaction.occurredAtSource, 'RECEIPT_FALLBACK', 'no time in the SMS: the receipt time is used and recorded as such');
    assert.equal(m.transaction.occurredAt, new Date(Date.parse(T('08:20:15')) + 2000).toISOString());
    assert.equal(m.fieldSources.counterpartyName, 'MANUAL');
    assert.equal(m.body, odd, 'the original SMS is unchanged');

    let s = (await call(env.app, 'GET', `/api/v1/summary${DAY}`, a.token)).body;
    assert.deepEqual([s.outgoing.total, s.pendingCount], ['15.00', 0]);
    assert.equal(s.balances[0].amount, '36.59');

    // A second device still holding version 1 gets a conflict with the current record instead of overwriting it.
    const stale = await call(env.app, 'PUT', `/api/v1/messages/${p.messageId}/classification`, a.token, { classification: 'NOT_TRANSACTION', expectedVersion: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'VERSION_CONFLICT');
    assert.equal(stale.body.details.current.version, 2);

    const reclass = await call(env.app, 'PUT', `/api/v1/messages/${p.messageId}/classification`, a.token, { classification: 'NOT_TRANSACTION', expectedVersion: 2 });
    assert.equal(reclass.status, 200);
    s = (await call(env.app, 'GET', `/api/v1/summary${DAY}`, a.token)).body;
    assert.deepEqual([s.outgoing.total, s.outgoing.count], ['0.00', 0], 'non-transactions never count');
    const ignored = (await call(env.app, 'GET', '/api/v1/messages?filter=ignored', a.token)).body.items;
    assert.equal(ignored[0].id, p.messageId, 'informational messages are kept, not deleted');

    const history = (await call(env.app, 'GET', `/api/v1/messages/${p.messageId}`, a.token)).body.history;
    assert.deepEqual(history.map((h: any) => h.action), ['INGEST', 'CLASSIFY', 'CLASSIFY']);
    assert.equal(history[1].actorDeviceName, 'Viewer');
    assert.equal(history[1].previous.classification, 'PENDING');
    assert.equal(history[2].previous.amount, '15.00');
    assert.ok(history[2].changedAt);

    await assert.rejects(withAccount(env.db, a.accountId, tx => tx.query(`UPDATE messages SET body = 'changed' WHERE id = $1`, [p.messageId])), /immutable/);
    await assert.rejects(withAccount(env.db, a.accountId, tx => tx.query('DELETE FROM messages WHERE id = $1', [p.messageId])), /cannot be deleted/);
  });

  test('manual corrections survive parser reprocessing; parser results are refreshed', async () => {
    const a = await sourceAccount(env.app);
    const [auto, manual] = await ingest(env.app, a.token, [sms(a.numberId, IN_SMS('3'), T('15:40:45')), sms(a.numberId, OUT_SMS('4'), T('15:41:45'))]);
    await call(env.app, 'PUT', `/api/v1/messages/${manual.messageId}/classification`, a.token, { classification: 'TRANSACTION', expectedVersion: 1, direction: 'OUT', amount: '4.25' });
    // Simulate a stale stored parser result, then reprocess everything.
    await withAccount(env.db, a.accountId, tx => tx.query(`UPDATE messages SET classification = 'PENDING', classification_source = 'PARSER', direction = NULL, amount_milli = NULL, currency = NULL, occurred_at = NULL, occurred_at_source = NULL WHERE id = $1`, [auto.messageId]));
    for (const id of [auto.messageId, manual.messageId]) await withAccount(env.db, a.accountId, tx => reprocessMessage(tx, a.accountId, id));
    const m = (await call(env.app, 'GET', `/api/v1/messages/${manual.messageId}`, a.token)).body.message;
    assert.deepEqual([m.transaction.amount, m.classificationSource, m.version], ['4.25', 'MANUAL', 2]);
    assert.equal(m.parsed.amount, '4.00', 'the parser suggestion is updated but not applied');
    const r = (await call(env.app, 'GET', `/api/v1/messages/${auto.messageId}`, a.token)).body.message;
    assert.equal(r.classification, 'TRANSACTION');
  });
});

describe('totals and balances', () => {
  test('money keeps three decimals and sums exactly', async () => {
    const a = await sourceAccount(env.app);
    await ingest(env.app, a.token, [
      sms(a.numberId, IN_SMS('54.585', '100', '19/10/26 18:00:00'), T('15:00:01')),
      sms(a.numberId, IN_SMS('0.005', '100.005', '19/10/26 18:01:00'), T('15:01:01')),
      sms(a.numberId, IN_SMS('0.10', '100.105', '19/10/26 18:02:00'), T('15:02:01')),
      sms(a.numberId, IN_SMS('0.20', '100.305', '19/10/26 18:03:00'), T('15:03:01')),
    ]);
    const s = (await call(env.app, 'GET', `/api/v1/summary${DAY}`, a.token)).body;
    assert.equal(s.incoming.total, '54.89');
    const tx = (await call(env.app, 'GET', `/api/v1/transactions${DAY}`, a.token)).body;
    assert.equal(tx.items.find((i: any) => i.transaction.amount === '54.585').transaction.amount, '54.585');
    assert.equal(s.balances[0].amount, '100.305');
  });

  test('an older SMS imported later never replaces a newer balance', async () => {
    const a = await sourceAccount(env.app);
    await ingest(env.app, a.token, [sms(a.numberId, OUT_SMS('1', '20.50', '19/10/26 18:40:41'), T('15:40:45'))]);
    let b = (await call(env.app, 'GET', '/api/v1/balances', a.token)).body.balances[0];
    assert.equal(b.amount, '20.50');
    // Initial import later delivers an SMS from earlier that day.
    await ingest(env.app, a.token, [{ ...sms(a.numberId, IN_SMS('5', '99.99', '19/10/26 09:00:00'), T('06:00:05')), importMethod: 'INITIAL_IMPORT' }]);
    b = (await call(env.app, 'GET', '/api/v1/balances', a.token)).body.balances[0];
    assert.equal(b.amount, '20.50');
    assert.equal(b.effectiveAt, '2026-10-19T15:40:41.000Z');
  });

  test('transactions: search by name, number or reference, date range and pagination', async () => {
    const a = await sourceAccount(env.app);
    const items = Array.from({ length: 35 }, (_, i) => sms(a.numberId, IN_SMS(String(i + 1), '1', `19/10/26 1${Math.floor(i / 10)}:${String(i % 10).padStart(2, '0')}:00`), T(`${String(Math.floor(i / 10) + 7).padStart(2, '0')}:${String(i % 10).padStart(2, '0')}:05`)));
    items.push(sms(a.numberId, '[-EVCPlus-] $9 ayaad uwareejisay Sahra Maxamed (615443312), Ref: AB-77, Tar: 19/10/26 20:00:00 Haraagaagu waa $1', T('17:00:05')));
    await ingest(env.app, a.token, items);
    const page1 = (await call(env.app, 'GET', `/api/v1/transactions${DAY}&limit=20`, a.token)).body;
    assert.equal(page1.items.length, 20);
    const page2 = (await call(env.app, 'GET', `/api/v1/transactions${DAY}&limit=20&cursor=${page1.nextCursor}`, a.token)).body;
    assert.equal(page2.items.length, 16);
    assert.equal(page2.nextCursor, null);
    assert.equal(new Set([...page1.items, ...page2.items].map((i: any) => i.id)).size, 36);
    for (const q of ['sahra', '0615443312', 'ab-77', '615 44']) {
      const r = (await call(env.app, 'GET', `/api/v1/transactions?q=${encodeURIComponent(q)}`, a.token)).body;
      assert.equal(r.items.length, 1, q);
    }
    const out = (await call(env.app, 'GET', `/api/v1/transactions${DAY}&filter=out`, a.token)).body;
    assert.equal(out.items.length, 1);
    assert.equal(out.totals.outgoing, '9.00');
    const other = (await call(env.app, 'GET', '/api/v1/transactions?period=custom&from=2026-10-18&to=2026-10-18', a.token)).body;
    assert.equal(other.items.length, 0);
    assert.equal((await call(env.app, 'GET', '/api/v1/transactions?period=custom&from=2026-10-20&to=2026-10-01', a.token)).status, 400);
  });
});

describe('devices and sync status', () => {
  test('heartbeat records contact separately from the last successful upload', async () => {
    const a = await sourceAccount(env.app);
    let me = (await call(env.app, 'GET', '/api/v1/me', a.token)).body;
    assert.equal(me.device.lastUploadAt, null);
    await call(env.app, 'POST', '/api/v1/devices/me/heartbeat', a.token, { smsPermission: 'GRANTED', queuePending: 3, queueFailed: 0, appVersion: '1.2.0' });
    me = (await call(env.app, 'GET', '/api/v1/me', a.token)).body;
    assert.ok(me.device.lastSeenAt);
    assert.equal(me.device.lastUploadAt, null);
    assert.deepEqual([me.device.smsPermission, me.device.queuePending, me.device.role], ['GRANTED', 3, 'SOURCE']);
    await ingest(env.app, a.token, [sms(a.numberId, IN_SMS(), T('15:40:45'))]);
    me = (await call(env.app, 'GET', '/api/v1/me', a.token)).body;
    assert.ok(me.device.lastUploadAt);
  });

  test('a number has one source phone; replacing it is explicit; one SIM maps to one number', async () => {
    const a = await sourceAccount(env.app);
    const second = await viewerLogin(env.app, a.phone, 'android');
    const clash = await call(env.app, 'POST', `/api/v1/evc-numbers/${a.numberId}/source`, second, { simSubscriptionId: 5 });
    assert.equal(clash.status, 409);
    const ok = await call(env.app, 'POST', `/api/v1/evc-numbers/${a.numberId}/source`, second, { simSubscriptionId: 5, replace: true });
    assert.equal(ok.status, 200);
    const [old] = await ingest(env.app, a.token, [sms(a.numberId, IN_SMS(), T('15:40:45'))]);
    assert.equal(old.code, 'NOT_SOURCE_FOR_NUMBER', 'the replaced phone can no longer upload for this number');
    const extra = await call(env.app, 'POST', '/api/v1/evc-numbers', second, { msisdn: '0771234567', displayName: 'Dukaan' });
    assert.equal(extra.status, 201);
    const sameSim = await call(env.app, 'POST', `/api/v1/evc-numbers/${extra.body.id}/source`, second, { simSubscriptionId: 5 });
    assert.equal(sameSim.status, 409);
    assert.equal(sameSim.body.error, 'SIM_IN_USE');
  });
});

describe('live updates', () => {
  test('other devices are notified after a change is committed', async () => {
    const a = await sourceAccount(env.app);
    const viewer = await viewerLogin(env.app, a.phone, 'ios');
    const address = await env.app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    const res = await fetch(`${address}/api/v1/events`, { headers: { authorization: `Bearer ${viewer}` }, signal: controller.signal });
    const reader = res.body!.getReader();
    const read = async () => new TextDecoder().decode((await reader.read()).value);
    assert.match(await read(), /event: ready/);
    await ingest(env.app, a.token, [sms(a.numberId, IN_SMS(), T('15:40:45'))]);
    let got = '';
    for (let i = 0; i < 5 && !got.includes('event: change'); i++) got += await read();
    assert.match(got, /event: change/);
    controller.abort();
  });
});

describe('change polling (serverless hosting)', () => {
  test('the change counter rises only for the account whose data changed', async () => {
    const a = await sourceAccount(env.app);
    const b = await sourceAccount(env.app);
    const seq = async (token: string) => { const r = await call(env.app, 'GET', '/api/v1/changes', token); assert.equal(r.status, 200); return BigInt(r.body.seq); };
    assert.equal((await call(env.app, 'GET', '/api/v1/changes')).status, 401);
    const a0 = await seq(a.token), b0 = await seq(b.token);
    await ingest(env.app, a.token, [sms(a.numberId, IN_SMS(), T('08:00:00'))]);
    assert.ok(await seq(a.token) > a0, 'a sees its own new message');
    assert.equal(await seq(b.token), b0, 'b sees nothing from a');
    const health = await call(env.app, 'GET', '/api/v1/health?db=1');
    assert.equal(health.body.database, 'ok');
  });
});
