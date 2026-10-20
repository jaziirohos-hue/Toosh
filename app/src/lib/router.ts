import { useEffect, useState } from 'react';

/** Hash routes: #/guud, #/fariimaha, #/fariin/<id>, #/dhaqdhaqaaq, #/dejinta, #/taleefanka-asalka */
export function useRoute(): string[] {
  const read = () => (window.location.hash.replace(/^#\/?/, '') || 'guud').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export function navigate(path: string) { window.location.hash = `#/${path}`; }
export function goBack(fallback = 'guud') {
  if (window.history.length > 1) window.history.back(); else navigate(fallback);
}
