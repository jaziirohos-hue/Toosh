import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parseAmount, sumMilli, toDecimalString } from '../src/money.ts';
import { formatMsisdn, maskMsisdn, normalizeSomaliMsisdn } from '../src/phone.ts';
import { periodRange, zonedTimeToUtc } from '../src/time.ts';
import { validateClassification } from '../src/classification.ts';

test('amounts keep three decimals exactly and never round', () => {
  const ok = (s: string) => { const r = parseAmount(s); assert.ok(r.ok, s); return r.ok ? r.milli : 0n; };
  assert.equal(ok('54.585'), 54585n);
  assert.equal(ok('3'), 3000n);
  assert.equal(ok('3.9'), 3900n);
  assert.equal(ok('1,250.50'), 1250500n);
  assert.equal(ok('$0.750'), 750n);
  assert.deepEqual(parseAmount('3.1234'), { ok: false, error: 'PRECISION' });
  assert.deepEqual(parseAmount('-1'), { ok: false, error: 'FORMAT' });
  assert.deepEqual(parseAmount('0'), { ok: false, error: 'NOT_POSITIVE' });
  assert.deepEqual(parseAmount('1e3'), { ok: false, error: 'FORMAT' });
  assert.deepEqual(parseAmount('12,34'), { ok: false, error: 'FORMAT' });
  assert.equal(toDecimalString(54585n), '54.585');
  assert.equal(toDecimalString(51590n), '51.59');
  assert.equal(toDecimalString(3000n), '3.00');
  assert.equal(formatMoney(1250500n, { sign: '+' }), '+$1,250.50');
  assert.equal(formatMoney(-3900n), '-$3.90');
});

test('sums are exact where binary floating point is not', () => {
  // 0.1 + 0.2 style errors: ten payments of $0.10 and one of $54.585
  const values = [...Array(10).fill(100n), 54585n];
  assert.equal(toDecimalString(sumMilli(values)), '55.585');
  let float = 0; for (let i = 0; i < 10; i++) float += 0.1;
  assert.notEqual(float, 1); // what Number arithmetic would do: 0.9999999999999999
  assert.equal(toDecimalString(sumMilli(Array(10).fill(100n))), '1.00');
  for (const s of ['0.001', '999999999.999', '12.34', '54.585']) {
    const r = parseAmount(s); assert.ok(r.ok);
    if (r.ok) assert.equal(parseAmount(toDecimalString(r.milli)).ok && (parseAmount(toDecimalString(r.milli)) as any).milli, r.milli);
  }
});

test('Somali numbers in any common format become one E.164 number', () => {
  for (const s of ['+252 61 512 3456', '252615123456', '0615123456', '615123456', '00252615123456', '(061) 512-3456']) {
    assert.deepEqual(normalizeSomaliMsisdn(s), { ok: true, e164: '+252615123456' }, s);
  }
  assert.equal(normalizeSomaliMsisdn('12345').ok, false);
  assert.equal(normalizeSomaliMsisdn('+254712345678').ok, false);
  assert.equal(normalizeSomaliMsisdn('61XXXXXXX').ok, false);
  assert.equal(formatMsisdn('+252615123456'), '+252 61 512 3456');
  assert.equal(maskMsisdn('+252615123456'), '+252 61 ••• ••56');
});

test('periods use the account timezone', () => {
  const now = new Date('2026-10-20T22:30:00Z'); // 01:30 on 21 Oct in Mogadishu
  const today = periodRange('today', 'Africa/Mogadishu', now);
  assert.equal(today.start.toISOString(), '2026-10-20T21:00:00.000Z');
  assert.equal(today.end.toISOString(), '2026-10-21T21:00:00.000Z');
  const week = periodRange('week', 'Africa/Mogadishu', now); // Wednesday -> Monday 19 Oct
  assert.equal(week.start.toISOString(), '2026-10-18T21:00:00.000Z');
  const month = periodRange('month', 'Africa/Mogadishu', now);
  assert.equal(month.start.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(month.end.toISOString(), '2026-10-31T21:00:00.000Z');
  const custom = periodRange('custom', 'Africa/Mogadishu', now, '2026-10-01', '2026-10-01');
  assert.equal(custom.end.getTime() - custom.start.getTime(), 86400000);
  assert.throws(() => periodRange('custom', 'Africa/Mogadishu', now, '2026-10-05', '2026-10-01'));
  assert.equal(zonedTimeToUtc(2026, 3, 29, 2, 30, 0, 'Europe/London').toISOString(), '2026-03-29T01:30:00.000Z');
});

test('classification validation is shared by app and server', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  const good = validateClassification({ classification: 'TRANSACTION', expectedVersion: 1, direction: 'OUT', amount: '15.00', counterpartyPhone: '061 599 8822', balance: '36.59', occurredAt: '2026-10-20T08:20:15Z' }, now);
  assert.ok(good.ok);
  if (good.ok) { assert.equal(good.value.amountMilli, 15000n); assert.equal(good.value.counterpartyPhone, '+252615998822'); assert.equal(good.value.balanceMilli, 36590n); }
  const bad = validateClassification({ classification: 'TRANSACTION', expectedVersion: 1, amount: '-5', currency: 'EUR', occurredAt: '2030-01-01T00:00:00Z' }, now);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'currency', 'direction', 'occurredAt']);
  assert.ok(validateClassification({ classification: 'NOT_TRANSACTION', expectedVersion: 3 }).ok);
  assert.equal(validateClassification({ classification: 'NOT_TRANSACTION' }).ok, false);
});
