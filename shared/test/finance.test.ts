import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATEGORIES, formatCurrency, isIsoDate, parseCategoryRef, validateBudget, validateExpense, validateGoal } from '../src/finance.ts';

test('built-in categories: Biil first, no Guriga, Qarashaad Kale last', () => {
  assert.equal(BUILTIN_CATEGORIES[0].so, 'Biil');
  assert.equal(BUILTIN_CATEGORIES.at(-1)!.so, 'Qarashaad Kale');
  assert.ok(!BUILTIN_CATEGORIES.some(c => /guri/i.test(c.so)));
  assert.equal(BUILTIN_CATEGORIES.length, 11);
});

test('category refs', () => {
  assert.deepEqual(parseCategoryRef('korantada'), { kind: 'builtin', key: 'korantada' });
  assert.deepEqual(parseCategoryRef('custom:0F8FAD5B-D9CB-469F-A165-70867728950E'), { kind: 'custom', id: '0f8fad5b-d9cb-469f-a165-70867728950e' });
  for (const bad of ['guriga', 'custom:x', '', null, 3]) assert.equal(parseCategoryRef(bad), null);
});

test('dates', () => {
  assert.ok(isIsoDate('2024-02-29'));
  assert.ok(!isIsoDate('2023-02-29'));
  assert.ok(!isIsoDate('2024-1-01'));
});

test('expense validation', () => {
  const ok = validateExpense({ name: ' Koronto ', amount: '12.5', currency: 'USD', category: 'korantada', spentOn: '2026-10-01', paymentStatus: 'PAID' }, '2026-10-23');
  assert.ok(ok.ok && ok.value.amountMilli === 12500n && ok.value.name === 'Koronto' && ok.value.description === null);
  const bad = validateExpense({ name: '', amount: '0', currency: 'EUR', category: 'x', spentOn: '2026-10-24', paymentStatus: 'X' }, '2026-10-23');
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'category', 'currency', 'name', 'paymentStatus', 'spentOn']);
});

test('budget and goal validation', () => {
  const b = validateBudget({ period: 'WEEKLY', amount: '50', currency: 'SOS' });
  assert.ok(b.ok && b.value.alertPercent === 80 && b.value.category === null);
  assert.ok(!validateBudget({ period: 'YEARLY', amount: '50', currency: 'USD', alertPercent: 0 }).ok);
  const g = validateGoal({ name: 'Gaari', target: '1000', currency: 'USD' });
  assert.ok(g.ok && g.value.savedMilli === 0n);
  assert.ok(!validateGoal({ name: 'x', target: '0', currency: 'USD' }).ok);
});

test('currency display', () => {
  assert.equal(formatCurrency(12500000n, 'SOS'), 'SOS 12,500');
  assert.equal(formatCurrency(1500n, 'SOS', '+'), '+SOS 1.5');
  assert.equal(formatCurrency(3900n, 'USD', '-'), '-$3.90');
});
