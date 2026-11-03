import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRulePattern, matchRule, numbersIn, parseWithRules, suggestName, type LearnedRule } from '../src/index.ts';

// A made-up format standing in for a network Toosh does not know yet (sender "EDAHAB").
const EX = '[-EDAHAB-] Waxaad $12.50 u dirtay CABDI XASAN NUUR(659998877) 03/11/26 10:20:30. Haraagaaga waa $40.25 Mahadsanid';
const LATER = '[-EDAHAB-] Waxaad $3 u dirtay HODAN(651112233) 04/11/26 08:01:02. Haraagaaga waa $37.25 Mahadsanid';

test('numbers and a suggested name for the teaching screen', () => {
  assert.deepEqual(numbersIn(EX).map(n => n.value).slice(0, 2), ['12.50', '659998877.00']);
  assert.equal(suggestName(EX), 'CABDI XASAN NUUR');
  assert.equal(suggestName('[-JEEB-] $0.05 ayaad u dirtay SADAAM XUSEEN CALI(612729106),Tar: x'), 'SADAAM XUSEEN CALI');
});

test('a taught money-out format recognises later messages with other amounts, names, numbers and times', () => {
  const b = buildRulePattern({ body: EX, direction: 'OUT', amount: '12.50', balance: '40.25', counterpartyName: 'CABDI XASAN NUUR' });
  assert.ok(b.ok);
  const rules: LearnedRule[] = [{ id: 'r1', sender: 'EDAHAB', pattern: (b as { pattern: string }).pattern, direction: 'OUT' }];
  const p = parseWithRules(LATER, 'eDahab', rules, { receivedAt: new Date('2026-11-04T05:01:05Z') });
  assert.equal(p.parserVersion, 'rule:r1');
  assert.equal(p.kind, 'TRANSACTION');
  assert.equal(p.direction, 'OUT');
  assert.equal(p.amountMilli, 3000n);
  assert.equal(p.balanceMilli, 37250n);
  assert.equal(p.counterpartyName, 'HODAN');
  assert.equal(p.counterpartyPhone, '+252651112233');
  assert.equal(p.autoConfirm, true);
  // Same wording from another sender, or different wording, is not taught.
  assert.equal(matchRule(rules, '5551234', LATER), null);
  assert.equal(matchRule(rules, 'EDAHAB', LATER.replace('u dirtay', 'ka heshay')), null);
});

test('the built-in parser wins when it can confirm the SMS itself', () => {
  const body = '[-EVCPlus-] $3.90 ayaad uwareejisay Qof Tusaale(615551288), Haraagaagu waa $51.59.';
  const b = buildRulePattern({ body, direction: 'IN', amount: '3.90' });
  const rules: LearnedRule[] = [{ id: 'x', sender: '192', pattern: (b as { pattern: string }).pattern, direction: 'IN' }];
  const p = parseWithRules(body, '192', rules);
  assert.equal(p.direction, 'OUT');
  assert.ok(!p.parserVersion.startsWith('rule:'));
});

test('"not money" rules mark matching messages as not a transaction', () => {
  const promo = 'EDAHAB: Ku guuleyso $100 hadiyad! Dir 1 ilaa 2233';
  const b = buildRulePattern({ body: promo, direction: 'NONE' });
  assert.ok(b.ok);
  const p = parseWithRules('EDAHAB: Ku guuleyso $250 hadiyad! Dir 7 ilaa 2233', 'EDAHAB', [{ id: 'n', sender: 'EDAHAB', pattern: (b as { pattern: string }).pattern, direction: 'NONE' }]);
  assert.equal(p.kind, 'BALANCE');
  assert.equal(p.autoConfirm, false);
});

test('examples that cannot be taught say why', () => {
  assert.deepEqual(buildRulePattern({ body: EX, direction: 'OUT', amount: '99' }), { ok: false, error: 'AMOUNT_NOT_FOUND' });
  assert.deepEqual(buildRulePattern({ body: EX, direction: 'OUT' }), { ok: false, error: 'AMOUNT_REQUIRED' });
  assert.deepEqual(buildRulePattern({ body: EX, direction: 'OUT', amount: '12.50', counterpartyName: 'NOT THERE' }), { ok: false, error: 'NAME_NOT_FOUND' });
});

test('shared rule vectors (also checked by the Android app, LearnedRules.java)', async () => {
  const { readFileSync } = await import('node:fs');
  const vectors = JSON.parse(readFileSync(new URL('./rule-vectors.json', import.meta.url), 'utf8'));
  for (const v of vectors) {
    const hit = matchRule([v.rule], v.sender, v.body);
    assert.equal(Boolean(hit), v.match, v.body);
    assert.equal(Boolean(hit) && v.rule.direction !== 'NONE', v.keeps, v.body);
  }
});
