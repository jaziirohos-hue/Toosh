/**
 * Durable queue of manual classifications made while offline (or while the server was unreachable).
 * Each entry carries the record version it was based on, so the server can detect a concurrent edit from another
 * device. A conflict is never resolved silently: the entry waits in state "conflict" until the person chooses.
 */
import { ApiFailure, api } from './api.ts';
import { idbGet, idbSet } from './idb.ts';
import type { Message } from './types.ts';

export type OutboxState = 'queued' | 'syncing' | 'failed' | 'conflict';
export interface OutboxEntry {
  messageId: string;
  request: Record<string, unknown> & { expectedVersion: number };
  state: OutboxState;
  queuedAt: string;
  attempts: number;
  error: string | null;
  fieldErrors?: Record<string, string>;
  /** Server copy at the time of a version conflict. */
  current?: Message;
}

const KEY = 'outbox';
type Listener = (entries: OutboxEntry[]) => void;
const listeners = new Set<Listener>();
let cache: OutboxEntry[] | null = null;
let flushing: Promise<void> | null = null;

async function load(): Promise<OutboxEntry[]> {
  if (!cache) cache = ((await idbGet<OutboxEntry[]>(KEY)) ?? []).map(e => (e.state === 'syncing' ? { ...e, state: 'queued' as const } : e));
  return cache;
}
async function save(entries: OutboxEntry[]) {
  cache = entries;
  await idbSet(KEY, entries);
  listeners.forEach(fn => fn(entries));
}

export async function outboxEntries() { return [...(await load())]; }
export function onOutbox(fn: Listener) { listeners.add(fn); load().then(fn); return () => { listeners.delete(fn); }; }

/** Adds or replaces the queued change for a message, then tries to send it. */
export async function enqueueClassification(messageId: string, request: OutboxEntry['request'], onSaved?: (m: Message) => void) {
  const entries = (await load()).filter(e => e.messageId !== messageId);
  entries.push({ messageId, request, state: 'queued', queuedAt: new Date().toISOString(), attempts: 0, error: null });
  await save(entries);
  await flushOutbox(onSaved);
}

export async function discardEntry(messageId: string) {
  await save((await load()).filter(e => e.messageId !== messageId));
}

/** Keep my change: resend it on top of the version that is now on the server. */
export async function overwriteWithMine(messageId: string, onSaved?: (m: Message) => void) {
  const entries = await load();
  const entry = entries.find(e => e.messageId === messageId);
  if (!entry?.current) return;
  entry.request = { ...entry.request, expectedVersion: entry.current.version };
  entry.state = 'queued'; entry.current = undefined; entry.error = null;
  await save([...entries]);
  await flushOutbox(onSaved);
}

let saved: ((m: Message) => void) | undefined;
export async function flushOutbox(onSaved?: (m: Message) => void): Promise<void> {
  if (onSaved) saved = onSaved;
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      for (const entry of [...(await load())]) {
        if (entry.state !== 'queued') continue;
        entry.state = 'syncing'; entry.attempts++;
        await save([...(await load())]);
        try {
          const res = await api<{ message: Message }>(`/messages/${entry.messageId}/classification`, { method: 'PUT', body: entry.request });
          await save((await load()).filter(e => e !== entry));
          saved?.(res.message);
          window.dispatchEvent(new CustomEvent('toosh:changed'));
        } catch (e) {
          const f = e as ApiFailure;
          if (f.status === 0 || f.status >= 500 || f.status === 429) { entry.state = 'queued'; entry.error = f.message; await save([...(await load())]); break; }
          if (f.code === 'VERSION_CONFLICT') { entry.state = 'conflict'; entry.current = f.details?.current; entry.error = f.message; }
          else { entry.state = 'failed'; entry.error = f.message; entry.fieldErrors = f.details && typeof f.details === 'object' && !f.details.current ? f.details : undefined; }
          await save([...(await load())]);
        }
      }
    } finally { flushing = null; }
  })();
  return flushing;
}

/** Retries queued entries with backoff while any remain; called on start and whenever the connection returns. */
let timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleOutboxRetry(delayMs = 5000) {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    await flushOutbox();
    const waiting = (await load()).some(e => e.state === 'queued');
    if (waiting) scheduleOutboxRetry(Math.min(delayMs * 2, 120000));
  }, delayMs);
}

export async function clearOutbox() { await save([]); }
