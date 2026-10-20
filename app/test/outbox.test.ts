/**
 * Offline classification queue: survives restarts, retries when the server is unreachable, never overwrites a
 * concurrent edit silently. IndexedDB is provided by fake-indexeddb; the server is a scripted fetch.
 */
import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as any;
const events = new EventTarget();
g.window = g.window ?? { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), location: { hash: '' } };
g.CustomEvent = g.CustomEvent ?? class extends Event { detail: unknown; constructor(t: string, i?: any) { super(t); this.detail = i?.detail; } };

type Reply = { status: number; body: unknown } | 'offline';
let replies: Reply[] = [];
let calls: { url: string; body: any }[] = [];
g.fetch = async (url: string, init: any) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  const r = replies.shift() ?? 'offline';
  if (r === 'offline') throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

const message = (version: number, extra: Record<string, unknown> = {}) => ({ id: 'm1', version, classification: 'TRANSACTION', ...extra });

async function fresh() {
  // Re-import the module with an empty in-memory cache, as after an app restart (IndexedDB contents survive).
  return import(`../src/lib/outbox.ts?restart=${Math.random()}`) as Promise<typeof import('../src/lib/outbox.ts')>;
}

beforeEach(async () => { replies = []; calls = []; const o = await fresh(); await o.clearOutbox(); });

test('a change made offline is kept across a restart and sent when the connection returns', async () => {
  let o = await fresh();
  replies = ['offline'];
  await o.enqueueClassification('m1', { classification: 'TRANSACTION', expectedVersion: 1, direction: 'OUT', amount: '15.00' });
  let entries = await o.outboxEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, 'queued', 'unreachable server: still queued, not failed');

  o = await fresh(); // app restarted
  entries = await o.outboxEntries();
  assert.equal(entries.length, 1, 'queue survived the restart');
  let saved: any = null;
  replies = [{ status: 200, body: { message: message(2) } }];
  await o.flushOutbox(m => { saved = m; });
  assert.equal(saved.version, 2);
  assert.equal((await o.outboxEntries()).length, 0);
  assert.equal(calls.at(-1)!.body.expectedVersion, 1, 'the request carries the version it was based on');
});

test('server errors and rate limits are retried; validation errors are reported', async () => {
  const o = await fresh();
  replies = [{ status: 503, body: { error: 'UNAVAILABLE', message: 'down' } }];
  await o.enqueueClassification('m1', { classification: 'TRANSACTION', expectedVersion: 1, direction: 'OUT', amount: '15.00' });
  assert.equal((await o.outboxEntries())[0].state, 'queued');
  replies = [{ status: 400, body: { error: 'VALIDATION', message: 'bad', details: { amount: 'Geli qaddarka lacagta.' } } }];
  await o.flushOutbox();
  const [e] = await o.outboxEntries();
  assert.equal(e.state, 'failed');
  assert.deepEqual(e.fieldErrors, { amount: 'Geli qaddarka lacagta.' });
});

test('a concurrent edit becomes a visible conflict; the person chooses mine or theirs', async () => {
  const o = await fresh();
  replies = [{ status: 409, body: { error: 'VERSION_CONFLICT', message: 'changed', details: { current: message(2, { classification: 'NOT_TRANSACTION' }) } } }];
  await o.enqueueClassification('m1', { classification: 'TRANSACTION', expectedVersion: 1, direction: 'IN', amount: '5' });
  let [e] = await o.outboxEntries();
  assert.equal(e.state, 'conflict');
  assert.equal(e.current!.version, 2);
  assert.equal(calls.length, 1, 'no automatic retry that would overwrite the other device');

  // "Kaydi kayga": resend on top of the version now on the server.
  replies = [{ status: 200, body: { message: message(3) } }];
  await o.overwriteWithMine('m1');
  assert.equal(calls.at(-1)!.body.expectedVersion, 2);
  assert.equal((await o.outboxEntries()).length, 0);

  // "Hayso kooda": discard mine.
  replies = [{ status: 409, body: { error: 'VERSION_CONFLICT', message: 'changed', details: { current: message(4) } } }];
  await o.enqueueClassification('m1', { classification: 'NOT_TRANSACTION', expectedVersion: 3 });
  [e] = await o.outboxEntries();
  assert.equal(e.state, 'conflict');
  await o.discardEntry('m1');
  assert.equal((await o.outboxEntries()).length, 0);
});

test('a newer edit of the same message replaces the queued one instead of sending both', async () => {
  const o = await fresh();
  replies = ['offline'];
  await o.enqueueClassification('m1', { classification: 'TRANSACTION', expectedVersion: 1, direction: 'IN', amount: '5' });
  replies = ['offline'];
  await o.enqueueClassification('m1', { classification: 'TRANSACTION', expectedVersion: 1, direction: 'OUT', amount: '6' });
  const entries = await o.outboxEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].request.direction, 'OUT');
});
