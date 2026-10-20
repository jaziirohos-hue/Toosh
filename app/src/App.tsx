import { useEffect, useRef, useState } from 'react';
import { Banner, BottomNav, Icon, Logo, Spinner } from './components/ui.tsx';
import { api, qs } from './lib/api.ts';
import { isNativeAndroid, TooshNative } from './lib/native.ts';
import { useRoute } from './lib/router.ts';
import { SessionProvider, useSession } from './lib/session.tsx';
import { useResource } from './lib/sync.ts';
import type { Summary } from './lib/types.ts';
import { Auth } from './screens/Auth.tsx';
import { Dejinta } from './screens/Dejinta.tsx';
import { Dhaqdhaqaaq } from './screens/Dhaqdhaqaaq.tsx';
import { Fariimaha } from './screens/Fariimaha.tsx';
import { Guud } from './screens/Guud.tsx';
import { KalaSaar } from './screens/KalaSaar.tsx';
import { SourceSetup } from './screens/SourceSetup.tsx';

const LOCK_AFTER_MS = 30000;

/** PIN / fingerprint lock (Android BiometricPrompt with device-credential fallback). */
function LockGate({ children }: { children: React.ReactNode }) {
  const { prefs } = useSession();
  const enabled = isNativeAndroid && prefs.lock;
  const [locked, setLocked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const hiddenAt = useRef<number | null>(null);
  async function unlock() {
    setError(null);
    const r = await TooshNative.authenticate({ title: 'Fur Toosh', subtitle: 'Isticmaal faraha ama PIN-ka taleefanka' }).catch(() => ({ success: false, error: null }));
    if (r.success) setLocked(false); else setError(r.error ?? 'Lama xaqiijin. Isku day mar kale.');
  }
  useEffect(() => { if (enabled && locked) unlock(); /* first open */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled) { setLocked(false); return; }
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) { setLocked(true); unlock(); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!locked) return <>{children}</>;
  return <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-margin text-center">
    <Logo className="w-16 h-16" /><h1 className="font-headline-md text-headline-md">Toosh waa xiran yahay</h1>
    {error && <Banner tone="error" icon="lock">{error}</Banner>}
    <button onClick={unlock} className="h-12 px-6 rounded-lg bg-primary-container text-on-primary font-title-md text-title-md flex items-center gap-2"><Icon name="fingerprint" />Fur</button>
  </main>;
}

function Shell() {
  const { me, selectedNumberId, meIsCached } = useSession();
  const route = useRoute();
  const pending = useResource<Summary>(selectedNumberId ? `pending:${selectedNumberId}` : null, () => api(`/summary${qs({ period: 'today', evcNumberId: selectedNumberId })}`));
  const [page, arg] = route;
  let screen: React.ReactNode; let nav = true;
  if (page === 'fariimaha') screen = <Fariimaha key={arg ?? 'all'} initialFilter={arg} />;
  else if (page === 'fariin' && arg) { screen = <KalaSaar key={arg} id={arg} />; nav = false; }
  else if (page === 'dhaqdhaqaaq') screen = <Dhaqdhaqaaq />;
  else if (page === 'dejinta') screen = <Dejinta />;
  else if (page === 'taleefanka-asalka') { screen = <SourceSetup />; nav = false; }
  else screen = <Guud />;
  return <div className="bg-surface text-on-surface font-body-md min-h-screen flex flex-col">
    {meIsCached && <div className="fixed top-16 inset-x-0 z-40 flex justify-center pointer-events-none"><span className="mt-1 px-3 py-1 rounded-full bg-inverse-surface text-inverse-on-surface font-label-ui text-label-ui">Offline · xog kaydsan</span></div>}
    {me && screen}
    {nav && <BottomNav active={page === 'fariin' ? 'fariimaha' : page ?? 'guud'} pending={pending.data?.pendingCount ?? 0} />}
  </div>;
}

function Root() {
  const { status } = useSession();
  if (status === 'loading') return <div className="min-h-dvh flex flex-col items-center justify-center gap-3"><Logo className="w-14 h-14" /><Spinner label="Toosh waa la furayaa…" /></div>;
  if (status === 'signedOut') return <div className="bg-surface text-on-surface font-body-md min-h-screen flex flex-col"><Auth /></div>;
  return <LockGate><Shell /></LockGate>;
}

export function App() {
  return <SessionProvider><Root /></SessionProvider>;
}
