/**
 * App PIN: kept only on this device, never sent anywhere and never stored as plain text. What is stored is a
 * PBKDF2-SHA-256 hash with a random salt. Wrong guesses are counted and slowed down.
 */
const KEY = 'toosh.pin';
const ATTEMPTS = 'toosh.pin.attempts';
const ITERATIONS = 310000;

interface StoredPin { v: 1; salt: string; hash: string; iterations: number; length: number }
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
}
function read(): StoredPin | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v && v.v === 1 ? v : null; } catch { return null; }
}
export const hasPin = () => read() !== null;
export const pinLength = () => read()?.length ?? 4;
export const validPin = (pin: string) => /^\d{4,6}$/.test(pin);

export async function setPin(pin: string) {
  if (!validPin(pin)) throw new Error('PIN must be 4-6 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  localStorage.setItem(KEY, JSON.stringify({ v: 1, salt: b64(salt), hash: b64(hash), iterations: ITERATIONS, length: pin.length } satisfies StoredPin));
  localStorage.removeItem(ATTEMPTS);
}
export function clearPin() { localStorage.removeItem(KEY); localStorage.removeItem(ATTEMPTS); }

interface Attempts { failed: number; until: number }
function attempts(): Attempts { try { return { failed: 0, until: 0, ...JSON.parse(localStorage.getItem(ATTEMPTS) ?? '{}') }; } catch { return { failed: 0, until: 0 }; } }
/** Milliseconds to wait before the next guess is accepted (0 = now). */
export const pinWaitMs = () => Math.max(0, attempts().until - Date.now());
export const pinFailures = () => attempts().failed;

/** Checks a PIN. After 5 wrong tries each further wrong try makes the wait longer: 30 s, 60 s, 2 min … up to 1 hour. */
export async function checkPin(pin: string): Promise<{ ok: boolean; waitMs: number }> {
  const stored = read();
  if (!stored) return { ok: false, waitMs: 0 };
  const wait = pinWaitMs();
  if (wait > 0) return { ok: false, waitMs: wait };
  const hash = new Uint8Array(await derive(pin, unb64(stored.salt), stored.iterations));
  const expected = unb64(stored.hash);
  let diff = hash.length ^ expected.length;
  for (let i = 0; i < Math.min(hash.length, expected.length); i++) diff |= hash[i] ^ expected[i];
  if (diff === 0) { localStorage.removeItem(ATTEMPTS); return { ok: true, waitMs: 0 }; }
  const a = attempts();
  const failed = a.failed + 1;
  const until = failed >= 5 ? Date.now() + Math.min(3600e3, 30e3 * 2 ** (failed - 5)) : 0;
  localStorage.setItem(ATTEMPTS, JSON.stringify({ failed, until }));
  return { ok: false, waitMs: Math.max(0, until - Date.now()) };
}
