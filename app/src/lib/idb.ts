/** Minimal IndexedDB key-value store, with an in-memory fallback when IndexedDB is unavailable. */
const DB_NAME = 'toosh';
const STORE = 'kv';
let opening: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(db => new Promise(resolve => {
    if (!db) return resolve(undefined);
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => resolve(undefined);
  }));
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.get(key) as T | undefined;
  return run<T>('readonly', s => s.get(key));
}
export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) { memory.set(key, value); return; }
  await run('readwrite', s => s.put(value, key));
}
export async function idbDelete(key: string): Promise<void> {
  const db = await open();
  if (!db) { memory.delete(key); return; }
  await run('readwrite', s => s.delete(key));
}
export async function idbClear(): Promise<void> {
  memory.clear();
  const db = await open();
  if (db) await run('readwrite', s => s.clear());
}
