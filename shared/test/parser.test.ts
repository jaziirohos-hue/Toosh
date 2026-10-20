import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvcSms } from '../src/parser.ts';

const received = (iso: string) => ({ receivedAt: new Date(iso) });

test('outgoing: "ayaad uwareejisay" with name, redacted phone and balance (spec example 1)', () => {
  const p = parseEvcSms('[-EVCPlus-] $3.90 ayaad uwareejisay Qof Tusaale(61XXXXXXX), Haraagaagu waa $51.59.');
  assert.equal(p.kind, 'TRANSACTION');
  assert.equal(p.direction, 'OUT');
  assert.equal(p.amountMilli, 3900n);
  assert.equal(p.currency, 'USD');
  assert.equal(p.counterpartyName, 'Qof Tusaale');
  assert.equal(p.counterpartyPhone, null); // redacted digits are never guessed
  assert.ok(p.issues.includes('PHONE_UNREADABLE'));
  assert.equal(p.balanceMilli, 51590n);
  assert.equal(p.occurredAt, null);
  assert.ok(p.issues.includes('TIME_MISSING'));
  assert.equal(p.autoConfirm, true, 'missing time is not blocking: the receipt time is used as a recorded fallback');
});

test('incoming: "waxaad … ka heshay" with Tar: time and 3-decimal balance (spec example 2)', () => {
  const p = parseEvcSms('[-EVCPLUS-] waxaad $3 ka heshay 61XXXXXXX, Tar: 19/10/26 18:40:41 haraagagu waa $54.585.', received('2026-10-19T15:40:45Z'));
  assert.equal(p.direction, 'IN');
  assert.equal(p.amountMilli, 3000n);
  assert.equal(p.balanceMilli, 54585n, '$54.585 is kept exactly');
  assert.equal(p.occurredAt, '2026-10-19T15:40:41.000Z', 'SMS time is read in Africa/Mogadishu (UTC+3)');
  assert.equal(p.autoConfirm, true);
});

test('real phone numbers are normalised to E.164', () => {
  const out = parseEvcSms('[-EVCPlus-] $3.90 ayaad uwareejisay Jaamac Cali Xasan (252615551288), Tariikh: 24/05/26 10:38:12, Haraagaagu waa $51.59.', received('2026-05-24T07:38:20Z'));
  assert.equal(out.counterpartyName, 'Jaamac Cali Xasan');
  assert.equal(out.counterpartyPhone, '+252615551288');
  assert.equal(out.occurredAt, '2026-05-24T07:38:12.000Z');
  const inn = parseEvcSms('[-EVCPlus-] Waxaad $3.00 ka heshay Sahra Maxamed Cumar (0615443312), Tariikh: 24/05/26 09:15:02, Haraagaagu waa $54.585.', received('2026-05-24T06:15:05Z'));
  assert.equal(inn.direction, 'IN');
  assert.equal(inn.counterpartyName, 'Sahra Maxamed Cumar');
  assert.equal(inn.counterpartyPhone, '+252615443312');
});

test('capitalisation, extra whitespace, line breaks and spelling variants', () => {
  const variants = [
    '[-evcplus-]   $3.90 AYAAD  U WAREEJISAY Qof Tusaale(615551288),\nHaraagaagu waa $51.59.',
    '[-EVCPlus-]\n$3.90 ayaad u wareejisey Qof Tusaale (615551288), haraagaaga waa $51.59',
    '[- EVC Plus -] $3.90 Ayaad Uwareejisay Qof Tusaale(615551288), Haraaga waa: $51.59',
  ];
  for (const body of variants) {
    const p = parseEvcSms(body);
    assert.equal(p.direction, 'OUT', body);
    assert.equal(p.amountMilli, 3900n, body);
    assert.equal(p.balanceMilli, 51590n, body);
    assert.equal(p.counterpartyPhone, '+252615551288', body);
    assert.equal(p.autoConfirm, true, body);
  }
  const multiLineIn = parseEvcSms('[-EVCPLUS-] waxaad $12.5 ka\nheshay 615998822,\nTar: 01/10/26 08:00:00\nharaagagu waa $60', received('2026-10-01T05:00:10Z'));
  assert.equal(multiLineIn.direction, 'IN');
  assert.equal(multiLineIn.amountMilli, 12500n);
});

test('promotional links are ignored when extracting fields', () => {
  const p = parseEvcSms('[-EVCPlus-] $5 ayaad uwareejisay Ali (615551288), Haraagaagu waa $10.25. Ka qeyb gal https://promo.example.com/win?amount=$100 www.hormuud.com/offer');
  assert.equal(p.amountMilli, 5000n);
  assert.ok(!p.issues.includes('MULTIPLE_AMOUNTS'));
  assert.equal(p.autoConfirm, true);
});

test('ambiguous direction goes to review', () => {
  const p = parseEvcSms('[-EVCPlus-] waxaad $3 ka heshay 615551288 ayaad uwareejisay $3, Haraagaagu waa $10');
  assert.ok(p.issues.includes('AMBIGUOUS_DIRECTION'));
  assert.equal(p.direction, null);
  assert.equal(p.autoConfirm, false);
});

test('unknown wording (u dirtay, bixisay) is not auto-confirmed and direction is never guessed', () => {
  for (const body of ['[-EVCPlus-] $15.00 waxaad u dirtay 615998822 Tariikh: 24/05/26 11:20:15.', '[-EVCPlus-] Waxaad bixisay $4.20 xisaabta ganacsiga 892211']) {
    const p = parseEvcSms(body);
    assert.equal(p.kind, 'TRANSACTION', body);
    assert.equal(p.direction, null, body);
    assert.ok(p.issues.includes('NO_DIRECTION'), body);
    assert.equal(p.autoConfirm, false, body);
  }
});

test('direction is never inferred from balance changes', () => {
  const p = parseEvcSms('[-EVCPlus-] $3.00 Haraagaagu waa $54.585'); // amount + balance, no wording
  assert.equal(p.direction, null);
  assert.equal(p.autoConfirm, false);
});

test('malformed and incomplete messages', () => {
  const noAmount = parseEvcSms('[-EVCPlus-] ayaad uwareejisay Ali (615551288)');
  assert.ok(noAmount.issues.includes('NO_AMOUNT'));
  assert.equal(noAmount.autoConfirm, false);
  const two = parseEvcSms('[-EVCPlus-] $3 ayaad uwareejisay Ali $4');
  assert.ok(two.issues.includes('MULTIPLE_AMOUNTS'));
  assert.equal(two.autoConfirm, false);
  const precision = parseEvcSms('[-EVCPlus-] $3.1234 ayaad uwareejisay Ali');
  assert.ok(precision.issues.includes('AMOUNT_PRECISION'));
  assert.equal(precision.amountMilli, null);
  const zero = parseEvcSms('[-EVCPlus-] $0 ayaad uwareejisay Ali');
  assert.equal(zero.autoConfirm, false);
  const badDate = parseEvcSms('[-EVCPlus-] waxaad $3 ka heshay 615551288, Tar: 31/02/26 10:00:00');
  assert.ok(badDate.issues.includes('TIME_INVALID'));
  assert.equal(badDate.autoConfirm, false);
  const shilling = parseEvcSms('[-EVCPlus-] waxaad 45,000 SLSH ka heshay 615551288');
  assert.equal(shilling.autoConfirm, false);
  const notEvc = parseEvcSms('Your OTP is 1234');
  assert.equal(notEvc.kind, 'UNRECOGNIZED');
  assert.equal(parseEvcSms('').autoConfirm, false);
});

test('an SMS time far from the receipt time is treated as suspicious', () => {
  const p = parseEvcSms('[-EVCPLUS-] waxaad $3 ka heshay 615551288, Tar: 19/10/25 18:40:41', received('2026-10-19T15:40:45Z'));
  assert.ok(p.issues.includes('TIME_FAR_FROM_RECEIPT'));
  assert.equal(p.autoConfirm, false);
});

test('balance-only message is not a transaction but carries a balance', () => {
  const p = parseEvcSms('[-EVCPlus-] Haraagaagu waa $51.59');
  assert.equal(p.kind, 'BALANCE');
  assert.equal(p.balanceMilli, 51590n);
  assert.equal(p.autoConfirm, false);
});

test('provider reference is extracted when present', () => {
  const p = parseEvcSms('[-EVCPlus-] $7 ayaad uwareejisay Ali (615551288), Ref: TX-889211, Haraagaagu waa $1');
  assert.equal(p.providerRef, 'TX-889211');
  assert.equal(p.amountMilli, 7000n);
  const none = parseEvcSms('[-EVCPlus-] Waxaad idinka mahadsantihiin $7 ayaad uwareejisay Ali');
  assert.equal(none.providerRef, null);
});

test('parser is deterministic', () => {
  const body = '[-EVCPLUS-] waxaad $3 ka heshay 615551288, Tar: 19/10/26 18:40:41 haraagagu waa $54.585.';
  assert.deepEqual(parseEvcSms(body), parseEvcSms(body));
});
