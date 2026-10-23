import { useEffect } from 'react';
import { BottomNav, Logo, Spinner } from './components/ui.tsx';
import { api, qs } from './lib/api.ts';
import { t } from './lib/i18n.ts';
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
import { LockGate } from './screens/Lock.tsx';
import { Qarash } from './screens/Qarash.tsx';
import { SimCards } from './screens/SimCards.tsx';
import { SourceSetup } from './screens/SourceSetup.tsx';

function Shell() {
  const { me, selectedNumberId, meIsCached } = useSession();
  const route = useRoute();
  const pending = useResource<Summary>(selectedNumberId ? `pending:${selectedNumberId}` : null, () => api(`/summary${qs({ period: 'today', evcNumberId: selectedNumberId })}`));
  const [page, arg] = route;
  useEffect(() => { window.scrollTo(0, 0); }, []); // signing in keeps the address, so no route change resets the scroll
  let screen: React.ReactNode; let nav = true;
  if (page === 'fariimaha') screen = <Fariimaha key={arg ?? 'all'} initialFilter={arg} />;
  else if (page === 'fariin' && arg) { screen = <KalaSaar key={arg} id={arg} />; nav = false; }
  else if (page === 'dhaqdhaqaaq') screen = <Dhaqdhaqaaq />;
  else if (page === 'qarash') screen = <Qarash key={arg ?? 'list'} initialTab={arg} />;
  else if (page === 'dejinta') screen = <Dejinta />;
  else if (page === 'sim-card') screen = <SimCards />;
  else if (page === 'taleefanka-asalka') { screen = <SourceSetup />; nav = false; }
  else screen = <Guud />;
  return <div className="bg-surface text-on-surface font-body-md min-h-screen flex flex-col">
    {meIsCached && <div className="fixed top-[calc(env(safe-area-inset-top,0px)+64px)] inset-x-0 z-40 flex justify-center pointer-events-none"><span className="px-3 min-h-7 py-0.5 flex items-center rounded-full bg-inverse-surface text-inverse-on-surface text-[12px] font-semibold shadow-lg leading-tight">{t('Offline · xog kaydsan', 'Offline · saved data')}</span></div>}
    {me && screen}
    {nav && <BottomNav active={page === 'fariin' ? 'fariimaha' : page === 'sim-card' ? 'dejinta' : page ?? 'guud'} pending={pending.data?.pendingCount ?? 0} />}
  </div>;
}

function Root() {
  const { status } = useSession();
  if (status === 'loading') return <div className="min-h-[calc(100dvh/var(--app-zoom,1))] flex flex-col items-center justify-center gap-2 bg-surface"><Logo className="w-16 h-16" /><Spinner label={t('Toosh waa la furayaa…', 'Opening Toosh…')} /></div>;
  if (status === 'signedOut') return <div className="bg-surface text-on-surface font-body-md min-h-screen flex flex-col"><Auth /></div>;
  return <LockGate><Shell /></LockGate>;
}

/** Changing the language re-renders every screen with the new words. */
function Keyed() {
  const { prefs } = useSession();
  return <Root key={prefs.language} />;
}

export function App() {
  return <SessionProvider><Keyed /></SessionProvider>;
}
