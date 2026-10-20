import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_TIMEZONE } from '@toosh/shared';
import { API_BASE, ApiFailure, api, loadNativeToken, setToken } from './api.ts';
import { idbClear, idbGet, idbSet } from './idb.ts';
import { isNativeAndroid, TooshNative, type NativeStatus } from './native.ts';
import { clearOutbox, flushOutbox } from './outbox.ts';
import { setOfflineCopies, startLiveUpdates, stopLiveUpdates } from './sync.ts';
import type { Me } from './types.ts';

export interface DevicePrefs { lock: boolean; offlineCopies: boolean }
const PREFS_KEY = 'toosh.prefs';
export function readPrefs(): DevicePrefs {
  try { return { lock: false, offlineCopies: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return { lock: false, offlineCopies: true }; }
}

interface SessionValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: Me | null;
  meIsCached: boolean;
  tz: string;
  signedOutReason: string | null;
  refreshMe: () => Promise<void>;
  signIn: (kind: 'login' | 'register' | 'pair', body: Record<string, unknown>) => Promise<Me>;
  signOut: () => Promise<void>;
  selectedNumberId: string | null;
  setSelectedNumberId: (id: string) => void;
  native: NativeStatus | null;
  refreshNative: () => Promise<void>;
  prefs: DevicePrefs;
  setPrefs: (p: Partial<DevicePrefs>) => void;
}

const Ctx = createContext<SessionValue | null>(null);
export const useSession = () => { const v = useContext(Ctx); if (!v) throw new Error('SessionProvider missing'); return v; };

export function deviceDescriptor() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Linux/.test(ua) ? 'Linux' : '';
  return { name: `${os ? os + ' ' : ''}${browser} (Web)`.trim(), platform: 'web' as const };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [meIsCached, setMeIsCached] = useState(false);
  const [native, setNative] = useState<NativeStatus | null>(null);
  const [selectedNumberId, setSelected] = useState<string | null>(null);
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<DevicePrefs>(readPrefs);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refreshNative = useCallback(async () => {
    if (!isNativeAndroid) return;
    try { setNative(await TooshNative.getStatus()); } catch { /* plugin unavailable */ }
  }, []);

  const applyMe = useCallback((m: Me, cached = false) => {
    setMe(m); setMeIsCached(cached); setStatus('signedIn');
    setSelected(prev => (prev && m.evcNumbers.some(n => n.id === prev) ? prev : m.evcNumbers[0]?.id ?? null));
    if (!cached) idbSet('me', m).catch(() => {});
  }, []);

  const refreshMe = useCallback(async () => {
    try { applyMe(await api<Me>('/me')); }
    catch (e) {
      const f = e as ApiFailure;
      if (f.status === 401) return; // handled by the unauthenticated event
      const cached = await idbGet<Me>('me');
      if (cached) applyMe(cached, true); else if (status === 'loading') setStatus('signedOut');
    }
  }, [applyMe, status]);

  const resetLocal = useCallback(async (reason: string | null) => {
    stopLiveUpdates();
    setToken(null);
    if (isNativeAndroid) await TooshNative.setSession({ token: null, accountId: null, apiBase: API_BASE, deviceId: null }).catch(() => {});
    await clearOutbox(); await idbClear();
    setMe(null); setSelected(null); setSignedOutReason(reason); setStatus('signedOut');
  }, []);

  useEffect(() => {
    (async () => {
      setOfflineCopies(readPrefs().offlineCopies);
      await loadNativeToken().catch(() => {});
      await refreshNative();
      await refreshMe();
    })();
    // Only a device that was signed in is told its session ended; a first visit just shows the sign-in screen.
    const onUnauth = () => { resetLocal(statusRef.current === 'signedIn' ? 'Fadhigaagu wuu dhacay ama aaladdan waa laga saaray akoonka. Fadlan dib u gal.' : null); };
    window.addEventListener('toosh:unauthenticated', onUnauth);
    return () => window.removeEventListener('toosh:unauthenticated', onUnauth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'signedIn') return;
    startLiveUpdates();
    flushOutbox().catch(() => {});
    if (!isNativeAndroid) return;
    let handle: { remove: () => Promise<void> } | null = null;
    TooshNative.addListener('queueChanged', s => setNative(s)).then(h => { handle = h; }).catch(() => {});
    const t = setInterval(refreshNative, 15000);
    return () => { clearInterval(t); handle?.remove(); };
  }, [status, refreshNative]);

  const signIn = useCallback(async (kind: 'login' | 'register' | 'pair', body: Record<string, unknown>) => {
    const device = isNativeAndroid
      ? { name: native?.deviceModel ?? 'Android', platform: 'android', model: native?.deviceModel ?? null, appVersion: native?.appVersion ?? null }
      : deviceDescriptor();
    const res = await api<Me & { token: string | null }>(`/auth/${kind}`, { method: 'POST', body: { ...body, device } });
    const { token, ...m } = res;
    if (isNativeAndroid) {
      setToken(token);
      await TooshNative.setSession({ token, accountId: m.account.id, apiBase: API_BASE, deviceId: m.device.id });
    }
    setSignedOutReason(null);
    applyMe(m);
    return m;
  }, [applyMe, native]);

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* offline: local sign-out still happens */ }
    await resetLocal(null);
  }, [resetLocal]);

  const setPrefs = useCallback((p: Partial<DevicePrefs>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...p };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      setOfflineCopies(next.offlineCopies);
      return next;
    });
  }, []);

  const value = useMemo<SessionValue>(() => ({
    status, me, meIsCached, tz: me?.account.timezone ?? DEFAULT_TIMEZONE, signedOutReason, refreshMe, signIn, signOut,
    selectedNumberId, setSelectedNumberId: setSelected, native, refreshNative, prefs, setPrefs,
  }), [status, me, meIsCached, signedOutReason, refreshMe, signIn, signOut, selectedNumberId, native, refreshNative, prefs, setPrefs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
