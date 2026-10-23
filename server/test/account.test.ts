import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withAccount } from '../src/db.ts';
import { call, setup, sourceAccount, viewerLogin, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const PW = 'correct horse battery';

describe('profile and password', () => {
  test('rename the account', async () => {
    const a = await sourceAccount(env.app);
    assert.equal((await call(env.app, 'PATCH', '/api/v1/me', a.token, { displayName: '  ' })).status, 400);
    const r = await call(env.app, 'PATCH', '/api/v1/me', a.token, { displayName: 'Faadumo Cali' });
    assert.equal(r.status, 200);
    assert.equal(r.body.account.displayName, 'Faadumo Cali');
  });

  test('change password: needs the current one, signs out other viewers, keeps the SMS phone', async () => {
    const a = await sourceAccount(env.app);
    const viewer = await viewerLogin(env.app, a.phone);
    const other = await viewerLogin(env.app, a.phone);

    const wrong = await call(env.app, 'POST', '/api/v1/auth/password', viewer, { currentPassword: 'not it at all', newPassword: 'a brand new secret' });
    assert.equal(wrong.status, 400);
    assert.ok(wrong.body.details.currentPassword);
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/password', viewer, { currentPassword: PW, newPassword: 'short' })).status, 400);
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/password', viewer, { currentPassword: PW, newPassword: PW })).status, 400);

    const ok = await call(env.app, 'POST', '/api/v1/auth/password', viewer, { currentPassword: PW, newPassword: 'a brand new secret' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.signedOutDevices, 1);
    assert.equal((await call(env.app, 'GET', '/api/v1/me', viewer)).status, 200, 'the device that changed it stays signed in');
    assert.equal((await call(env.app, 'GET', '/api/v1/me', a.token)).status, 200, 'the SMS-reading phone keeps uploading');
    assert.equal((await call(env.app, 'GET', '/api/v1/me', other)).status, 401, 'other viewers must sign in again');

    assert.equal((await call(env.app, 'POST', '/api/v1/auth/login', undefined, { phone: a.phone, password: PW })).status, 401);
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/login', undefined, { phone: a.phone, password: 'a brand new secret' })).status, 200);
    const stored = await withAccount(env.db, a.accountId, async tx => (await tx.query('SELECT password_hash FROM accounts WHERE id = $1', [a.accountId])).rows[0].password_hash);
    assert.match(stored, /^scrypt\$/);
    assert.ok(!stored.includes('a brand new secret'));
  });
});

describe('recovery codes', () => {
  test('generate, use once, replace; stored only as hashes', async () => {
    const a = await sourceAccount(env.app);
    assert.deepEqual((await call(env.app, 'GET', '/api/v1/auth/recovery-codes', a.token)).body, { remaining: 0, createdAt: null });
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/recovery-codes', a.token, { password: 'wrong wrong' })).status, 400);
    const gen = await call(env.app, 'POST', '/api/v1/auth/recovery-codes', a.token, { password: PW });
    assert.equal(gen.status, 200);
    const codes: string[] = gen.body.codes;
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) assert.match(c, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    assert.equal((await call(env.app, 'GET', '/api/v1/auth/recovery-codes', a.token)).body.remaining, 10);
    const rows = await withAccount(env.db, a.accountId, async tx => (await tx.query('SELECT code_hash FROM recovery_codes')).rows);
    for (const r of rows) { assert.match(r.code_hash, /^scrypt\$/); for (const c of codes) assert.ok(!r.code_hash.includes(c.replace('-', ''))); }

    const viewer = await viewerLogin(env.app, a.phone);
    const bad = await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: a.phone, code: 'ZZZZZ-ZZZZZ', newPassword: 'recovered secret 1' });
    assert.equal(bad.status, 401);
    // Lower case and spaces are accepted.
    const rec = await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: a.phone, code: ` ${codes[3].toLowerCase().replace('-', ' ')} `, newPassword: 'recovered secret 1', device: { platform: 'android', name: 'New phone' } });
    assert.equal(rec.status, 200, JSON.stringify(rec.body));
    assert.ok(rec.body.token);
    assert.equal(rec.body.recoveryCodesRemaining, 9);
    assert.equal((await call(env.app, 'GET', '/api/v1/me', viewer)).status, 401, 'old viewers are signed out');
    assert.equal((await call(env.app, 'GET', '/api/v1/me', a.token)).status, 200, 'the SMS phone stays connected');
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/login', undefined, { phone: a.phone, password: 'recovered secret 1' })).status, 200);
    const again = await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: a.phone, code: codes[3], newPassword: 'recovered secret 2' });
    assert.equal(again.status, 401, 'a used code never works again');

    const regen = await call(env.app, 'POST', '/api/v1/auth/recovery-codes', rec.body.token, { password: 'recovered secret 1' });
    assert.equal(regen.status, 200);
    const replaced = await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: a.phone, code: codes[0], newPassword: 'recovered secret 2' });
    assert.equal(replaced.status, 401, 'old codes stop working after a new set');
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: a.phone, code: regen.body.codes[0], newPassword: 'recovered secret 2' })).status, 200);
  });

  test('wrong codes lock recovery and sign-in after 10 tries; unknown phone looks the same', async () => {
    const a = await sourceAccount(env.app);
    await call(env.app, 'POST', '/api/v1/auth/recovery-codes', a.token, { password: PW });
    const unknown = await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: '619999999', code: 'ZZZZZ-ZZZZZ', newPassword: 'whatever secret' });
    assert.equal(unknown.status, 401);
    for (let i = 0; i < 10; i++) {
      assert.equal((await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: a.phone, code: 'ZZZZZ-ZZZZZ', newPassword: 'whatever secret' })).status, 401);
    }
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/recover', undefined, { phone: a.phone, code: 'ZZZZZ-ZZZZZ', newPassword: 'whatever secret' })).status, 429);
    assert.equal((await call(env.app, 'POST', '/api/v1/auth/login', undefined, { phone: a.phone, password: PW })).status, 429);
  });
});
