import { isNativeAndroid, TooshNative } from './native.ts';

/**
 * Android: requests go to VITE_API_BASE with a bearer token kept in the Android Keystore-backed store.
 * Browser: requests go to the same origin and authenticate with an HttpOnly cookie the page cannot read.
 */
export const API_BASE: string = isNativeAndroid ? (import.meta.env.VITE_API_BASE ?? '') : '';
let token: string | null = null;

export async function loadNativeToken() {
  if (isNativeAndroid) token = (await TooshNative.getSession()).token;
}
export function setToken(value: string | null) { token = value; }
export function authHeaders(): Record<string, string> {
  return isNativeAndroid ? (token ? { Authorization: `Bearer ${token}` } : {}) : { 'X-Toosh-Client': 'web' };
}

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
  get offline() { return this.status === 0; }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: isNativeAndroid ? 'omit' : 'same-origin', signal: options.signal ?? AbortSignal.timeout(20000), cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' && options.signal?.aborted) throw e;
    throw new ApiFailure(0, 'OFFLINE', 'Internet lama heli karo. Xogta waxaa lagu kaydiyay aaladda, waana la diri doonaa marka khadku soo noqdo.');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('toosh:unauthenticated'));
    throw new ApiFailure(res.status, data?.error ?? 'ERROR', data?.message ?? 'Codsigu ma guuleysan. Isku day mar kale.', data?.details);
  }
  return data as T;
}

export const qs = (params: Record<string, string | number | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};
