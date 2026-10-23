import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSomaliMsisdn, normalizeSomaliSimNumber, validateSimCard } from '../src/index.ts';

test('SIM numbers accept every Somali network; sign-in numbers stay strict', () => {
  assert.deepEqual(normalizeSomaliSimNumber('090 777 1234'), { ok: true, e164: '+252907771234' });
  assert.deepEqual(normalizeSomaliSimNumber('652223344'), { ok: true, e164: '+252652223344' });
  assert.equal(normalizeSomaliSimNumber('512345678').ok, false);
  assert.equal(normalizeSomaliMsisdn('907771234').ok, false);
});

test('SIM card validation', () => {
  const ok = validateSimCard({ name: ' Shaqo ', phone: '61 512 3456', provider: 'SOMTEL', registeredOn: '2025-01-01', notes: '' }, '2026-10-23');
  assert.ok(ok.ok && ok.value.name === 'Shaqo' && ok.value.phone === '+252615123456' && ok.value.notes === null);
  const bad = validateSimCard({ name: 'x'.repeat(61), phone: '', provider: 'hormuud', registeredOn: '2026-10-24', notes: 'n'.repeat(501) }, '2026-10-23');
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['name', 'notes', 'phone', 'provider', 'registeredOn']);
});
