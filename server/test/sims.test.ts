import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withAccount } from '../src/db.ts';
import { call, ingest, OUT_SMS, setup, sms, sourceAccount, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const sim = (o: Record<string, unknown> = {}) => ({ name: 'SIM-ka shaqada', phone: '061 512 3456', provider: 'HORMUUD', registeredOn: '2024-03-15', notes: 'Dual SIM, slot 1', ...o });

describe('SIM cards', () => {
  test('add, list, search, filter, edit, validate', async () => {
    const a = await sourceAccount(env.app);
    const created = await call(env.app, 'POST', '/api/v1/sim-cards', a.token, sim());
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.simCard.phone, '+252615123456');
    assert.equal(created.body.simCard.provider, 'HORMUUD');
    const golis = await call(env.app, 'POST', '/api/v1/sim-cards', a.token, sim({ name: 'Golis Garowe', phone: '+252 90 777 1234', provider: 'GOLIS', notes: '' }));
    assert.equal(golis.status, 201, 'Golis numbers (90…) are accepted');
    assert.equal(golis.body.simCard.notes, null);
    await call(env.app, 'POST', '/api/v1/sim-cards', a.token, sim({ name: 'Somtel', phone: '652223344', provider: 'SOMTEL', notes: null }));

    assert.equal((await call(env.app, 'POST', '/api/v1/sim-cards', a.token, sim({ name: 'Copy' }))).status, 409, 'same number twice');
    const bad = await call(env.app, 'POST', '/api/v1/sim-cards', a.token, { name: '', phone: '123', provider: 'TELESOM', registeredOn: '2999-01-01' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.body.details).sort(), ['name', 'phone', 'provider', 'registeredOn']);

    const all = await call(env.app, 'GET', '/api/v1/sim-cards', a.token);
    assert.equal(all.body.total, 3);
    assert.deepEqual(all.body.simCards.map((s: any) => s.name), ['Golis Garowe', 'SIM-ka shaqada', 'Somtel']);
    assert.equal((await call(env.app, 'GET', '/api/v1/sim-cards?provider=GOLIS', a.token)).body.simCards.length, 1);
    assert.equal((await call(env.app, 'GET', '/api/v1/sim-cards?q=shaqada', a.token)).body.simCards.length, 1);
    assert.equal((await call(env.app, 'GET', '/api/v1/sim-cards?q=0652', a.token)).body.simCards[0].name, 'Somtel', 'search by number');
    assert.equal((await call(env.app, 'GET', '/api/v1/sim-cards?q=slot', a.token)).body.simCards.length, 1, 'search notes');
    assert.equal((await call(env.app, 'GET', '/api/v1/sim-cards?provider=X', a.token)).status, 400);

    const id = created.body.simCard.id;
    const edited = await call(env.app, 'PUT', `/api/v1/sim-cards/${id}`, a.token, sim({ name: 'SIM-ka guriga', provider: 'OTHER' }));
    assert.equal(edited.status, 200);
    assert.equal(edited.body.simCard.name, 'SIM-ka guriga');
    assert.equal(edited.body.simCard.provider, 'OTHER');
    assert.equal((await call(env.app, 'PUT', `/api/v1/sim-cards/${id}`, a.token, sim({ phone: '652223344' }))).status, 409, 'edit cannot duplicate a number');
  });

  test('delete removes only that record; EVC numbers and messages stay', async () => {
    const a = await sourceAccount(env.app);
    await ingest(env.app, a.token, [sms(a.numberId, OUT_SMS(), new Date().toISOString())]);
    const one = (await call(env.app, 'POST', '/api/v1/sim-cards', a.token, sim())).body.simCard;
    const two = (await call(env.app, 'POST', '/api/v1/sim-cards', a.token, sim({ name: 'Two', phone: '617778899' }))).body.simCard;
    const before = (await call(env.app, 'GET', '/api/v1/changes', a.token)).body.seq;
    const del = await call(env.app, 'DELETE', `/api/v1/sim-cards/${one.id}`, a.token);
    assert.equal(del.status, 200);
    assert.equal(del.body.name, 'SIM-ka shaqada');
    assert.ok(BigInt((await call(env.app, 'GET', '/api/v1/changes', a.token)).body.seq) > BigInt(before), 'other devices see the change');
    assert.equal((await call(env.app, 'DELETE', `/api/v1/sim-cards/${one.id}`, a.token)).status, 404);
    const left = (await call(env.app, 'GET', '/api/v1/sim-cards', a.token)).body.simCards;
    assert.deepEqual(left.map((s: any) => s.id), [two.id]);
    const me = (await call(env.app, 'GET', '/api/v1/me', a.token)).body;
    assert.equal(me.evcNumbers.length, 1, 'EVC numbers untouched');
    const counts = await withAccount(env.db, a.accountId, async tx => (await tx.query('SELECT (SELECT count(*) FROM messages)::int AS m, (SELECT count(*) FROM devices WHERE revoked_at IS NULL)::int AS d')).rows[0]);
    assert.deepEqual(counts, { m: 1, d: 1 });
  });

  test('accounts cannot see, edit or delete each other\'s SIM cards', async () => {
    const a = await sourceAccount(env.app);
    const b = await sourceAccount(env.app);
    const mine = (await call(env.app, 'POST', '/api/v1/sim-cards', a.token, sim())).body.simCard;
    assert.equal((await call(env.app, 'POST', '/api/v1/sim-cards', b.token, sim())).status, 201, 'the same number may be in two accounts');
    assert.equal((await call(env.app, 'GET', '/api/v1/sim-cards', b.token)).body.total, 1);
    assert.equal((await call(env.app, 'PUT', `/api/v1/sim-cards/${mine.id}`, b.token, sim({ name: 'Hacked' }))).status, 404);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/sim-cards/${mine.id}`, b.token)).status, 404);
    const still = (await call(env.app, 'GET', '/api/v1/sim-cards', a.token)).body.simCards;
    assert.equal(still[0].name, 'SIM-ka shaqada');
    assert.equal((await call(env.app, 'GET', '/api/v1/sim-cards')).status, 401);
    const leaked = await withAccount(env.db, b.accountId, async tx => (await tx.query('SELECT count(*)::int AS n FROM sim_cards WHERE id = $1', [mine.id])).rows[0].n);
    assert.equal(leaked, 0, 'row-level security hides other accounts even without a WHERE');
  });
});
