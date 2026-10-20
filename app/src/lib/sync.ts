import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { API_BASE, ApiFailure, authHeaders } from './api.ts';
import { idbGet, idbSet } from './idb.ts';
import { isNativeAndroid } from './native.ts';
import { flushOutbox, scheduleOutboxRetry } from './outbox.ts';

// ---------------------------------------------------------------------------------------------------------------
// Connection state: offline (no network), connecting, online (live updates connected).
// ---------------------------------------------------------------------------------------------------------------
export type Connection = 'online' | 'connecting' | 'offline';
let connection: Connection = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connecting';
let lastRefreshAt: string | null = null;
const connListeners = new Set<() => void>();
function setConnection(c: Connection) { if (c !== connection) { connection = c; connListeners.forEach(f => f()); } }
export function useConnection(): Connection {
  return useSyncExternalStore(f => { connListeners.add(f); return () => connListeners.delete(f); }, () => connection);
}
export const getLastRefreshAt = () => lastRefreshAt;

// ---------------------------------------------------------------------------------------------------------------
// Invalidation: any change on the server (another device, the source phone, our own outbox) refetches what is shown.
// ---------------------------------------------------------------------------------------------------------------
const invalidators = new Set<() => void>();
let debounce: ReturnType<typeof setTimeout> | null = null;
export function invalidateAll() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { debounce = null; invalidators.forEach(f => f()); }, 250);
}
if (typeof window !== 'undefined') window.addEventListener('toosh:changed', invalidateAll);

// ---------------------------------------------------------------------------------------------------------------
// Live events over a streaming fetch (works with a bearer token, unlike EventSource).
// ---------------------------------------------------------------------------------------------------------------
let stream: AbortController | null = null;
let highestSeq = 0n;
export function startLiveUpdates() {
  if (stream) return;
  const controller = new AbortController();
  stream = controller;
  let delay = 1000;
  const loop = async () => {
    while (!controller.signal.aborted) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) { setConnection('offline'); await sleep(3000, controller.signal); continue; }
      setConnection('connecting');
      try {
        const res = await fetch(`${API_BASE}/api/v1/events`, { headers: authHeaders(), credentials: isNativeAndroid ? 'omit' : 'same-origin', signal: controller.signal });
        if (res.status === 401) { window.dispatchEvent(new CustomEvent('toosh:unauthenticated')); return; }
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, i); buffer = buffer.slice(i + 2);
            if (chunk.startsWith('event: ready')) {
              setConnection('online'); delay = 1000;
              // Reconnected: refresh everything and send anything that waited.
              invalidateAll(); flushOutbox().catch(() => {});
            } else if (chunk.startsWith('event: change')) {
              // Out-of-order or repeated notifications are harmless: only a newer sequence triggers a refetch.
              const seq = /"seq":"?(\d+)/.exec(chunk)?.[1];
              const n = seq ? BigInt(seq) : 0n;
              if (n === 0n || n > highestSeq) { highestSeq = n > highestSeq ? n : highestSeq; invalidateAll(); }
            }
          }
        }
      } catch { /* network drop */ }
      if (controller.signal.aborted) return;
      setConnection(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connecting');
      await sleep(delay, controller.signal);
      delay = Math.min(delay * 2, 30000);
    }
  };
  loop();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
}
function onOnline() { setConnection('connecting'); scheduleOutboxRetry(500); invalidateAll(); }
function onOffline() { setConnection('offline'); }
export function stopLiveUpdates() {
  stream?.abort(); stream = null; highestSeq = 0n;
  window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline);
}
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => { const t = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });
}

// ---------------------------------------------------------------------------------------------------------------
// Cached resources: show the last good copy immediately (and when offline), refresh from the server.
// ---------------------------------------------------------------------------------------------------------------
let offlineCopies = true;
export function setOfflineCopies(enabled: boolean) { offlineCopies = enabled; }

export interface Resource<T> { data: T | undefined; error: ApiFailure | null; loading: boolean; stale: boolean; reload: () => void; savedAt: string | null }

export function useResource<T>(key: string | null, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ data: T | undefined; error: ApiFailure | null; loading: boolean; stale: boolean; savedAt: string | null }>(
    { data: undefined, error: null, loading: Boolean(key), stale: false, savedAt: null });
  const loader = useRef(load); loader.current = load;
  const seq = useRef(0);
  const fetchNow = useCallback(() => {
    if (!key) return;
    const id = ++seq.current;
    setState(s => ({ ...s, loading: true }));
    loader.current().then(data => {
      if (id !== seq.current) return;
      lastRefreshAt = new Date().toISOString();
      const savedAt = new Date().toISOString();
      setState({ data, error: null, loading: false, stale: false, savedAt });
      if (offlineCopies) idbSet(`cache:${key}`, { data, savedAt }).catch(() => {});
    }).catch((error: ApiFailure) => {
      if (id !== seq.current) return;
      setState(s => ({ ...s, error, loading: false, stale: s.data !== undefined }));
    });
  }, [key]);
  useEffect(() => {
    if (!key) { setState({ data: undefined, error: null, loading: false, stale: false, savedAt: null }); return; }
    let cancelled = false;
    setState({ data: undefined, error: null, loading: true, stale: false, savedAt: null });
    if (offlineCopies) {
      idbGet<{ data: T; savedAt: string }>(`cache:${key}`).then(cached => {
        if (!cancelled && cached) setState(s => (s.data === undefined ? { ...s, data: cached.data, stale: true, savedAt: cached.savedAt } : s));
      });
    }
    fetchNow();
    invalidators.add(fetchNow);
    return () => { cancelled = true; invalidators.delete(fetchNow); };
  }, [key, fetchNow]);
  return { ...state, reload: fetchNow };
}
