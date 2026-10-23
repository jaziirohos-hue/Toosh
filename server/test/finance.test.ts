import { withAccount } from '../src/db.ts';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, ingest, IN_SMS, OUT_SMS, setup, sms, sourceAccount, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const TZ = 'Africa/Mogadishu';
const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  .formatToParts(d).map(p => [p.type, p.value]));
/** "dd/mm/yy HH:MM:SS" (EVC Plus style) for a moment a few minutes ago, Mogadishu time. */
function evcTime(minutesAgo = 5) {
  const p = parts(new Date(Date.now() - minutesAgo * 60000));
  return `${p.day}/${p.month}/${p.year.slice(2)} ${p.hour}:${p.minute}:${p.second}`;
}
const todayLocal = () => { const p = parts(new Date()); return `${p.year}-${p.month}-${p.day}`; };
const isoMinutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const expense = (over: Record<string, unknown> = {}) => ({ name: 'Koronto bishan', amount: '25.00', currency: 'USD', category: 'korantada', spentOn: todayLocal(), paymentStatus: 'PAID', ...over });

describe('categories', () => {
  test('built-in list has Biil (bills) and no Guriga; custom categories can be added, renamed and archived', async () => {
    const a = await sourceAccount(env.app);
    const cats = await call(env.app, 'GET', '/api/v1/categories', a.token);
    assert.equal(cats.status, 200);
    const keys = cats.body.builtin.map((c: any) => c.key);
    assert.deepEqual(keys, ['biil', 'korantada', 'iskuulka', 'dugsiga', 'gaari_raac', 'kirada', 'biyaha', 'cuntada', 'internet', 'caafimaadka', 'kale']);
    assert.equal(cats.body.builtin[0].so, 'Biil');
    assert.ok(!JSON.stringify(cats.body).toLowerCase().includes('guriga'));

    const made = await call(env.app, 'POST', '/api/v1/categories', a.token, { name: 'Shidaal', icon: 'local_gas_station' });
    assert.equal(made.status, 201);
    assert.equal((await call(env.app, 'POST', '/api/v1/categories', a.token, { name: 'shidaal', icon: 'sell' })).status, 409, 'names are unique (any case)');
    assert.equal((await call(env.app, 'POST', '/api/v1/categories', a.token, { name: 'X', icon: 'not_an_icon' })).status, 400);
    const renamed = await call(env.app, 'PATCH', `/api/v1/categories/${made.body.id}`, a.token, { name: 'Shidaalka', icon: 'local_gas_station' });
    assert.equal(renamed.body.name, 'Shidaalka');

    const e = await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ category: made.body.ref }));
    assert.equal(e.status, 201);
    assert.equal(e.body.expense.category, made.body.ref);
    await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'MONTHLY', category: made.body.ref, amount: '50', currency: 'USD' });
    assert.equal((await call(env.app, 'DELETE', `/api/v1/categories/${made.body.id}`, a.token)).status, 200);
    // The past expense keeps its (now archived) category; the category can no longer be chosen; its budget is gone.
    assert.equal((await call(env.app, 'GET', `/api/v1/expenses/${e.body.expense.id}`, a.token)).body.expense.category, made.body.ref);
    assert.equal((await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ category: made.body.ref }))).status, 400);
    assert.equal((await call(env.app, 'GET', '/api/v1/budgets', a.token)).body.budgets.length, 0);
    const after = await call(env.app, 'GET', '/api/v1/categories', a.token);
    assert.equal(after.body.custom[0].archived, true);
  });
});

describe('expenses entered by hand', () => {
  test('create in USD and SOS, validate, edit with version check, delete (hidden, not lost)', async () => {
    const a = await sourceAccount(env.app);
    const usd = await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ description: 'Bisha Oktoobar' }));
    assert.equal(usd.status, 201);
    assert.deepEqual({ ...usd.body.expense, id: undefined, createdAt: undefined, updatedAt: undefined },
      { id: undefined, name: 'Koronto bishan', amount: '25.00', currency: 'USD', category: 'korantada', spentOn: todayLocal(), description: 'Bisha Oktoobar', paymentStatus: 'PAID', version: 1, createdAt: undefined, updatedAt: undefined });
    const sos = await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ name: 'Bas', amount: '15000', currency: 'SOS', category: 'gaari_raac', paymentStatus: 'UNPAID' }));
    assert.equal(sos.body.expense.amount, '15000.00');

    const bad = await call(env.app, 'POST', '/api/v1/expenses', a.token, { name: '', amount: '-1', currency: 'EUR', category: 'guriga', spentOn: '2099-01-01', paymentStatus: 'MAYBE' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.body.details).sort(), ['amount', 'category', 'currency', 'name', 'paymentStatus', 'spentOn']);

    const id = usd.body.expense.id;
    const edited = await call(env.app, 'PUT', `/api/v1/expenses/${id}`, a.token, { ...expense({ amount: '30.50', category: 'biil' }), expectedVersion: 1 });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.expense.version, 2);
    assert.equal(edited.body.expense.amount, '30.50');
    const stale = await call(env.app, 'PUT', `/api/v1/expenses/${id}`, a.token, { ...expense({ amount: '1' }), expectedVersion: 1 });
    assert.equal(stale.status, 409, 'an older edit cannot silently overwrite a newer one');
    assert.equal(stale.body.details.current.amount, '30.50');

    assert.equal((await call(env.app, 'DELETE', `/api/v1/expenses/${id}`, a.token)).status, 200);
    assert.equal((await call(env.app, 'GET', `/api/v1/expenses/${id}`, a.token)).status, 404);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/expenses/${id}`, a.token)).status, 404);
    const kept = await withAccount(env.db, a.accountId, tx => tx.query('SELECT deleted_at FROM expenses WHERE id = $1', [id]));
    assert.ok(kept.rows[0].deleted_at, 'the row is kept with deleted_at, not removed');
  });
});

describe('EVC payments, spending feed and money overview', () => {
  test('outgoing EVC payments get categories and appear with hand-entered expenses; totals and budgets add both', async () => {
    const a = await sourceAccount(env.app);
    const [out1] = await ingest(env.app, a.token, [sms(a.numberId, OUT_SMS('10.00', '90.00', evcTime(30)), isoMinutesAgo(30))]);
    const [out2] = await ingest(env.app, a.token, [sms(a.numberId, OUT_SMS('4.00', '86.00', evcTime(20)), isoMinutesAgo(20))]);
    const [inc] = await ingest(env.app, a.token, [sms(a.numberId, IN_SMS('50', '136.00', evcTime(10)), isoMinutesAgo(10))]);
    assert.equal(out1.classification, 'TRANSACTION');

    assert.equal((await call(env.app, 'PUT', `/api/v1/messages/${inc.messageId}/category`, a.token, { category: 'cuntada' })).status, 400, 'incoming money has no expense category');
    const cat = await call(env.app, 'PUT', `/api/v1/messages/${out1.messageId}/category`, a.token, { category: 'korantada' });
    assert.deepEqual(cat.body, { category: 'korantada' });
    assert.equal((await call(env.app, 'GET', `/api/v1/messages/${out1.messageId}`, a.token)).body.category, 'korantada');

    await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ name: 'Koronto kaash', amount: '5.00' }));
    await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ name: 'Biyo', amount: '20000', currency: 'SOS', category: 'biyaha' }));
    await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ name: 'Kiro', amount: '100', category: 'kirada', paymentStatus: 'UNPAID' }));

    const feed = await call(env.app, 'GET', '/api/v1/spending?period=month', a.token);
    assert.equal(feed.status, 200);
    assert.equal(feed.body.items.length, 5);
    assert.deepEqual(feed.body.items.filter((i: any) => i.source === 'EVC').map((i: any) => [i.amount, i.category]).sort(), [['10.00', 'korantada'], ['4.00', null]]);
    assert.deepEqual(feed.body.totals.USD, { paid: '19.00', unpaid: '100.00', count: 4 });
    assert.deepEqual(feed.body.totals.SOS, { paid: '20000.00', unpaid: '0.00', count: 1 });
    const korantada = await call(env.app, 'GET', '/api/v1/spending?period=month&category=korantada', a.token);
    assert.deepEqual(korantada.body.items.map((i: any) => i.amount).sort(), ['10.00', '5.00']);
    assert.equal((await call(env.app, 'GET', '/api/v1/spending?category=uncategorized', a.token)).body.items.length, 1);
    assert.equal((await call(env.app, 'GET', '/api/v1/spending?source=manual&q=biyo', a.token)).body.items.length, 1);
    const page1 = await call(env.app, 'GET', '/api/v1/spending?limit=2', a.token);
    const page2 = await call(env.app, 'GET', `/api/v1/spending?limit=2&cursor=${page1.body.nextCursor}`, a.token);
    const page3 = await call(env.app, 'GET', `/api/v1/spending?limit=2&cursor=${page2.body.nextCursor}`, a.token);
    assert.equal(new Set([...page1.body.items, ...page2.body.items, ...page3.body.items].map((i: any) => i.id)).size, 5, 'pages cover every item once');

    // Budgets: overall monthly (OK), Korantada monthly at 75% (WARNING at 70%), daily food (OK, nothing spent), SOS water (OVER).
    await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'MONTHLY', amount: '200', currency: 'USD' });
    await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'MONTHLY', category: 'korantada', amount: '20', currency: 'USD', alertPercent: 70 });
    await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'DAILY', category: 'cuntada', amount: '5', currency: 'USD' });
    const water = await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'MONTHLY', category: 'biyaha', amount: '10000', currency: 'SOS' });
    assert.equal(water.body.budget.status, 'OVER');
    assert.equal(water.body.budget.remaining, '-10000.00');
    const again = await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'MONTHLY', category: 'biyaha', amount: '30000', currency: 'SOS' });
    assert.equal(again.body.budget.id, water.body.budget.id, 'one budget per period, category and currency: saving again replaces it');
    assert.equal(again.body.budget.status, 'OK');
    const budgets = (await call(env.app, 'GET', '/api/v1/budgets', a.token)).body.budgets;
    const find = (period: string, category: string | null) => budgets.find((b: any) => b.period === period && b.category === category);
    assert.deepEqual([find('MONTHLY', null).spent, find('MONTHLY', null).status], ['19.00', 'OK']);
    assert.deepEqual([find('MONTHLY', 'korantada').spent, find('MONTHLY', 'korantada').percent, find('MONTHLY', 'korantada').status], ['15.00', 75, 'WARNING']);
    assert.deepEqual([find('DAILY', 'cuntada').spent, find('DAILY', 'cuntada').status], ['0.00', 'OK']);
    assert.equal((await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'YEARLY', amount: '1', currency: 'USD' })).status, 400);

    const fin = await call(env.app, 'GET', '/api/v1/finance?period=month', a.token);
    assert.equal(fin.status, 200);
    assert.deepEqual(fin.body.income, { USD: '50.00', SOS: '0.00' });
    assert.deepEqual(fin.body.expenses, { USD: '19.00', SOS: '20000.00' });
    assert.deepEqual(fin.body.remaining, { USD: '31.00', SOS: '-20000.00' });
    assert.deepEqual(fin.body.unpaid, { USD: '100.00', SOS: '0.00' });
    assert.deepEqual(fin.body.spendingMonth, { USD: '19.00', SOS: '20000.00' });
    assert.deepEqual(fin.body.categories.map((c: any) => [c.category, c.currency, c.amount]),
      [['biyaha', 'SOS', '20000.00'], ['korantada', 'USD', '15.00'], ['uncategorized', 'USD', '4.00']]);
    assert.equal(fin.body.budgets.length, 4);

    assert.equal((await call(env.app, 'PUT', `/api/v1/messages/${out1.messageId}/category`, a.token, { category: null })).body.category, null);
    assert.equal((await call(env.app, 'GET', '/api/v1/spending?category=uncategorized', a.token)).body.items.length, 2);
    assert.ok(out2.messageId);
  });

  test('savings goals: create, update progress, archive', async () => {
    const a = await sourceAccount(env.app);
    const g = await call(env.app, 'POST', '/api/v1/goals', a.token, { name: 'Lacag degdeg', target: '500', saved: '50', currency: 'USD', targetDate: '2027-06-30' });
    assert.equal(g.status, 201);
    const u = await call(env.app, 'PUT', `/api/v1/goals/${g.body.goal.id}`, a.token, { name: 'Lacag degdeg', target: '500', saved: '125.50', currency: 'USD', targetDate: '2027-06-30' });
    assert.equal(u.body.goal.saved, '125.50');
    assert.equal((await call(env.app, 'POST', '/api/v1/goals', a.token, { name: '', target: '0', currency: 'EUR' })).status, 400);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/goals/${g.body.goal.id}`, a.token)).status, 200);
    assert.equal((await call(env.app, 'GET', '/api/v1/goals', a.token)).body.goals.length, 0);
  });

  test('changes to expenses and budgets reach other devices (change counter rises)', async () => {
    const a = await sourceAccount(env.app);
    const seq = async () => BigInt((await call(env.app, 'GET', '/api/v1/changes', a.token)).body.seq);
    let s = await seq();
    const e = await call(env.app, 'POST', '/api/v1/expenses', a.token, expense());
    assert.ok(await seq() > s); s = await seq();
    const b = await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'WEEKLY', amount: '40', currency: 'USD' });
    assert.ok(await seq() > s); s = await seq();
    await call(env.app, 'DELETE', `/api/v1/budgets/${b.body.budget.id}`, a.token);
    assert.ok(await seq() > s, 'deleting a budget is also noticed'); s = await seq();
    await call(env.app, 'DELETE', `/api/v1/expenses/${e.body.expense.id}`, a.token);
    assert.ok(await seq() > s);
  });
});

describe('isolation between accounts', () => {
  test("one account can never see, change or use another account's expenses, categories, budgets or goals", async () => {
    const a = await sourceAccount(env.app);
    const b = await sourceAccount(env.app);
    const cat = await call(env.app, 'POST', '/api/v1/categories', a.token, { name: 'Dukaan', icon: 'shopping_cart' });
    const e = await call(env.app, 'POST', '/api/v1/expenses', a.token, expense({ category: cat.body.ref }));
    const bud = await call(env.app, 'PUT', '/api/v1/budgets', a.token, { period: 'MONTHLY', amount: '100', currency: 'USD' });
    const goal = await call(env.app, 'POST', '/api/v1/goals', a.token, { name: 'Gaari', target: '3000', currency: 'USD' });
    const [out] = await ingest(env.app, a.token, [sms(a.numberId, OUT_SMS('7.00', '93.00', evcTime(5)), isoMinutesAgo(5))]);

    assert.equal((await call(env.app, 'GET', `/api/v1/expenses/${e.body.expense.id}`, b.token)).status, 404);
    assert.equal((await call(env.app, 'PUT', `/api/v1/expenses/${e.body.expense.id}`, b.token, { ...expense(), expectedVersion: 1 })).status, 404);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/expenses/${e.body.expense.id}`, b.token)).status, 404);
    assert.equal((await call(env.app, 'POST', '/api/v1/expenses', b.token, expense({ category: cat.body.ref }))).status, 400, "B cannot use A's category");
    assert.equal((await call(env.app, 'PATCH', `/api/v1/categories/${cat.body.id}`, b.token, { name: 'Hacked', icon: 'sell' })).status, 404);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/categories/${cat.body.id}`, b.token)).status, 404);
    assert.equal((await call(env.app, 'DELETE', `/api/v1/budgets/${bud.body.budget.id}`, b.token)).status, 404);
    assert.equal((await call(env.app, 'PUT', `/api/v1/goals/${goal.body.goal.id}`, b.token, { name: 'x', target: '1', currency: 'USD' })).status, 404);
    assert.equal((await call(env.app, 'PUT', `/api/v1/messages/${out.messageId}/category`, b.token, { category: 'cuntada' })).status, 404);

    const bView = await call(env.app, 'GET', '/api/v1/spending', b.token);
    assert.equal(bView.body.items.length, 0);
    assert.equal((await call(env.app, 'GET', '/api/v1/categories', b.token)).body.custom.length, 0);
    assert.equal((await call(env.app, 'GET', '/api/v1/budgets', b.token)).body.budgets.length, 0);
    assert.equal((await call(env.app, 'GET', '/api/v1/goals', b.token)).body.goals.length, 0);
    assert.deepEqual((await call(env.app, 'GET', '/api/v1/finance', b.token)).body.expenses, { USD: '0.00', SOS: '0.00' });
    // A's data is untouched.
    assert.equal((await call(env.app, 'GET', `/api/v1/expenses/${e.body.expense.id}`, a.token)).body.expense.amount, '25.00');
  });
});
