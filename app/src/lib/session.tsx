import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_TIMEZONE } from '@toosh/shared';
import { API_BASE, ApiFailure, api, loadNativeToken, setToken } from './api.ts';
import { idbClear, idbGet, idbSet } from './idb.ts';
import { isNativeAndroid, TooshNative, type NativeStatus } from './native.ts';
import { clearOutbox, flushOutbox } from './outbox.ts';
import { clearPin } from './pin.ts';
import { setOfflineCopies, startLiveUpdates, stopLiveUpdates } from './sync.ts';
import { setLanguage, t, type Language } from './i18n.ts';
import type { Currency, Me } from './types.ts';

export interface DevicePrefs {
  /** Legacy: lock with the phone's own fingerprint / screen lock (kept for people who turned it on before app PINs). */
  lock: boolean;
  offlineCopies: boolean;
  /** Show ****** instead of money amounts. */
  hideAmounts: boolean;
  language: Language;
  /** True once the person picked a language; until then the app uses the default (English). */
  languageChosen?: boolean;
  /** Currency preselected for new expenses, budgets and goals. */
  currency: Currency;
  theme: 'system' | 'light' | 'dark';
  /** In-app and phone alerts when a budget nears or passes its limit. */
  budgetAlerts: boolean;
  /** Seconds the app may be in the background (or untouched) before it locks again. */
  lockAfter: number;
  /** App PIN lock is on (the PIN itself is a salted hash in lib/pin.ts). */
  appLock: boolean;
}
const PREFS_KEY = 'toosh.prefs';
const DEFAULT_PREFS: DevicePrefs = { lock: false, offlineCopies: true, hideAmounts: false, language: 'en', currency: 'USD', theme: 'system', budgetAlerts: true, lockAfter: 30, appLock: false };
export function readPrefs(): DevicePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    // English is the default. A language saved only because it was the old default (Somali) is not a choice.
    if (!saved.languageChosen) delete saved.language;
    return { ...DEFAULT_PREFS, ...saved };
  } catch { return { ...DEFAULT_PREFS }; }
}
/** Applies the theme and language to the document (called at start-up and whenever they change). */
export function applyLook(p: DevicePrefs) {
  setLanguage(p.language);
  const root = document.documentElement;
  if (p.theme === 'system') delete root.dataset.theme; else root.dataset.theme = p.theme;
  const dark = p.theme === 'dark' || (p.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1713' : '#f3f6f4');
}

interface SessionValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: Me | null;
  meIsCached: boolean;
  tz: string;
  signedOutReason: string | null;
  refreshMe: () => Promise<void>;
  signIn: (kind: 'login' | 'register' | 'pair' | 'recover', body: Record<string, unknown>) => Promise<Me>;
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
    // The app PIN and phone lock belong to the signed-in person; the next person to sign in starts without them.
    clearPin();
    setPrefsState(prev => { const next = { ...prev, appLock: false, lock: false, hideAmounts: false }; localStorage.setItem(PREFS_KEY, JSON.stringify(next)); return next; });
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
    const onUnauth = () => { resetLocal(statusRef.current === 'signedIn' ? t('Fadhigaagu wuu dhacay ama aaladdan waa laga saaray akoonka. Fadlan dib u gal.', 'Your session ended or this device was removed from the account. Please sign in again.') : null); };
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

  const signIn = useCallback(async (kind: 'login' | 'register' | 'pair' | 'recover', body: Record<string, unknown>) => {
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
      applyLook(next);
      return next;
    });
  }, []);

  const value = useMemo<SessionValue>(() => ({
    status, me, meIsCached, tz: me?.account.timezone ?? DEFAULT_TIMEZONE, signedOutReason, refreshMe, signIn, signOut,
    selectedNumberId, setSelectedNumberId: setSelected, native, refreshNative, prefs, setPrefs,
  }), [status, me, meIsCached, signedOutReason, refreshMe, signIn, signOut, selectedNumberId, native, refreshNative, prefs, setPrefs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
