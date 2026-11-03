import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, ingest, setup, sms, sourceAccount, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const tz = 'Africa/Mogadishu';
const evcTime = (minutesAgo: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(Date.now() - minutesAgo * 60000)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
};
const edahab = (amount: string, name: string, phone: string, balance: string, m: number) =>
  `[-EDAHAB-] Waxaad $${amount} u dirtay ${name}(${phone}) ${evcTime(m)}. Haraagaaga waa $${balance} Mahadsanid`;

describe('teaching Toosh a message format', () => {
  test('a waiting EVC message is sorted when its format is taught, and later ones are sorted on arrival', async () => {
    const a = await sourceAccount(env.app);
    const now = new Date().toISOString();
    const pendingBody = `[-EVCPlus-] $15.00 waxaad u dirtay 615998822 Tariikh: ${evcTime(3)}.`;
    const [first] = await ingest(env.app, a.token, [sms(a.numberId, pendingBody, now)]);
    assert.equal(first.classification, 'PENDING');

    const bad = await call(env.app, 'POST', '/api/v1/rules', a.token, { sender: '192', body: pendingBody, direction: 'OUT', amount: '99' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.amount);
    const taught = await call(env.app, 'POST', '/api/v1/rules', a.token, { sender: '192', body: pendingBody, direction: 'OUT', amount: '15.00' });
    assert.equal(taught.status, 201, JSON.stringify(taught.body));
    assert.equal(taught.body.sorted, 1, 'the waiting message was sorted');
    const m = (await call(env.app, 'GET', `/api/v1/messages/${first.messageId}`, a.token)).body.message;
    assert.equal(m.classification, 'TRANSACTION');
    assert.equal(m.transaction.direction, 'OUT');
    assert.equal(m.transaction.amount, '15.00');
    assert.equal(m.parserVersion, `rule:${taught.body.rule.id}`);

    const [later] = await ingest(env.app, a.token, [sms(a.numberId, `[-EVCPlus-] $4.25 waxaad u dirtay 617770011 Tariikh: ${evcTime(1)}.`, now)]);
    assert.equal(later.classification, 'TRANSACTION');
  });

  test('a new sender (not EVC Plus) is accepted only once its format is taught', async () => {
    const a = await sourceAccount(env.app);
    const now = new Date().toISOString();
    const example = edahab('12.50', 'CABDI XASAN NUUR', '659998877', '40.25', 5);
    const refused = (await call(env.app, 'POST', '/api/v1/ingest/messages', a.token, { messages: [{ ...sms(a.numberId, example, now), sender: 'EDAHAB' }] })).body.results[0];
    assert.equal(refused.status, 'rejected');
    assert.equal(refused.code, 'NOT_EVC_MESSAGE');

    const taught = await call(env.app, 'POST', '/api/v1/rules', a.token, { sender: 'EDAHAB', body: example, direction: 'OUT', amount: '12.50', balance: '40.25', counterpartyName: 'CABDI XASAN NUUR' });
    assert.equal(taught.status, 201, JSON.stringify(taught.body));
    assert.equal(taught.body.pattern.sender, 'EDAHAB');
    const list = (await call(env.app, 'GET', '/api/v1/rules', a.token)).body;
    assert.equal(list.rules.length, 1);
    assert.equal(list.patterns[0].pattern, taught.body.pattern.pattern, 'the phone gets the same pattern');

    const [r] = await ingest(env.app, a.token, [{ ...sms(a.numberId, edahab('3', 'HODAN', '651112233', '37.25', 1), now), sender: 'EDAHAB' }]);
    assert.equal(r.status, 'created');
    assert.equal(r.classification, 'TRANSACTION');
    const msg = (await call(env.app, 'GET', `/api/v1/messages/${r.messageId}`, a.token)).body.message;
    assert.deepEqual([msg.transaction.amount, msg.transaction.counterpartyName, msg.balance.amount], ['3.00', 'HODAN', '37.25']);

    // Forgetting the format keeps what it already sorted; new ones from that sender are refused again.
    assert.equal((await call(env.app, 'DELETE', `/api/v1/rules/${taught.body.rule.id}`, a.token)).status, 200);
    assert.equal((await call(env.app, 'GET', `/api/v1/messages/${r.messageId}`, a.token)).body.message.classification, 'TRANSACTION');
    const afterDelete = (await call(env.app, 'POST', '/api/v1/ingest/messages', a.token, { messages: [{ ...sms(a.numberId, edahab('9', 'ALI', '651112299', '28.25', 0), now), sender: 'EDAHAB' }] })).body.results[0];
    assert.equal(afterDelete.code, 'NOT_EVC_MESSAGE');
  });

  test('rules belong to one account', async () => {
    const a = await sourceAccount(env.app);
    const b = await sourceAccount(env.app);
    const ex = edahab('1', 'X', '659990000', '2', 0);
    const r = (await call(env.app, 'POST', '/api/v1/rules', a.token, { sender: 'EDAHAB', body: ex, direction: 'IN', amount: '1' })).body.rule;
    assert.equal((await call(env.app, 'GET', '/api/v1/rules', b.token)).body.rules.length, 0);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/rules/${r.id}`, b.token)).status, 404);
    const [x] = (await call(env.app, 'POST', '/api/v1/ingest/messages', b.token, { messages: [{ ...sms(b.numberId, ex, new Date().toISOString()), sender: 'EDAHAB' }] })).body.results;
    assert.equal(x.code, 'NOT_EVC_MESSAGE', "another account's rule does not apply");
    assert.equal((await call(env.app, 'GET', '/api/v1/rules')).status, 401);
  });
});
