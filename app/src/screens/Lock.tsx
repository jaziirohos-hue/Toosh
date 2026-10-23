import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Icon, Logo, Sheet } from '../components/ui.tsx';
import { t } from '../lib/i18n.ts';
import { isNativeAndroid, TooshNative } from '../lib/native.ts';
import { checkPin, hasPin, pinLength, pinWaitMs } from '../lib/pin.ts';
import { useSession } from '../lib/session.tsx';

/** Foreground: lock after this long without a touch even if the app never left the screen. */
const MIN_IDLE_MS = 2 * 60 * 1000;

/**
 * App lock: the app PIN (kept on this device as a salted hash) and/or the phone's fingerprint / screen lock.
 * Locks on open, after the app was in the background longer than the chosen time, and after inactivity.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const { prefs } = useSession();
  const pinOn = prefs.appLock && hasPin();
  const bioOn = isNativeAndroid && prefs.lock;
  const enabled = pinOn || bioOn;
  const [locked, setLocked] = useState(enabled);
  const hiddenAt = useRef<number | null>(null);
  const lastActive = useRef(Date.now());
  const limit = prefs.lockAfter * 1000;

  useEffect(() => { if (!enabled) setLocked(false); }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const touch = () => { lastActive.current = Date.now(); };
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= limit) setLocked(true);
    };
    const idle = setInterval(() => { if (!document.hidden && Date.now() - lastActive.current > Math.max(limit, MIN_IDLE_MS)) setLocked(true); }, 10000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch);
    return () => { clearInterval(idle); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); };
  }, [enabled, limit]);

  if (!enabled || !locked) return <>{children}</>;
  return <LockScreen pinOn={pinOn} bioOn={bioOn} onUnlock={() => { lastActive.current = Date.now(); hiddenAt.current = null; setLocked(false); }} />;
}

function LockScreen({ pinOn, bioOn, onUnlock }: { pinOn: boolean; bioOn: boolean; onUnlock: () => void }) {
  const { signOut, me } = useSession();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(pinWaitMs());
  const [checking, setChecking] = useState(false);
  const [forgot, setForgot] = useState(false);
  const length = pinLength();

  async function biometric() {
    setError(null);
    const r = await TooshNative.authenticate({ title: t('Fur Toosh', 'Unlock Toosh'), subtitle: t('Isticmaal faraha ama qufulka taleefanka', 'Use your fingerprint or phone screen lock') })
      .catch(() => ({ success: false, error: null }));
    if (r.success) onUnlock(); else if (!pinOn) setError(r.error ?? t('Lama xaqiijin. Isku day mar kale.', 'Not verified. Try again.'));
  }
  useEffect(() => { if (bioOn) biometric(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wait <= 0) return;
    const h = setInterval(() => setWait(pinWaitMs()), 1000);
    return () => clearInterval(h);
  }, [wait]);
  useEffect(() => {
    if (pin.length !== length || checking) return;
    setChecking(true);
    checkPin(pin).then(r => {
      if (r.ok) { onUnlock(); return; }
      setPin(''); setWait(r.waitMs);
      setError(r.waitMs > 0 ? t('PIN khaldan marar badan.', 'Too many wrong PINs.') : t('PIN-ku waa khalad. Isku day mar kale.', 'Wrong PIN. Try again.'));
    }).finally(() => setChecking(false));
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (d: string) => { if (wait > 0 || checking) return; setError(null); setPin(p => (p.length < length ? p + d : p)); };
  const key = (label: React.ReactNode, onClick: () => void, aria: string, extra = '') =>
    <button type="button" aria-label={aria} onClick={onClick} className={`h-16 rounded-full flex items-center justify-center text-[26px] font-semibold text-on-surface pressable active:bg-surface-container-high ${extra}`}>{label}</button>;

  return <main className="min-h-[calc(100dvh/var(--app-zoom,1))] flex flex-col items-center justify-center gap-5 px-6 py-8 text-center bg-surface screen-in" aria-label={t('Toosh waa xiran yahay', 'Toosh is locked')}>
    <div className="w-[76px] h-[76px] rounded-[24px] bg-surface-container-lowest shadow-[0_12px_32px_-12px_rgba(5,71,42,0.35)] flex items-center justify-center"><Logo className="w-14 h-14" /></div>
    <div>
      <h1 className="text-[22px] font-extrabold tracking-tight">{pinOn ? t('Geli PIN-ka Toosh', 'Enter your Toosh PIN') : t('Toosh waa xiran yahay', 'Toosh is locked')}</h1>
      {me && <p className="text-[14px] text-on-surface-variant mt-1 break-words">{me.account.displayName}</p>}
    </div>
    {pinOn && <div className="flex gap-3.5 h-5 items-center" aria-live="polite" aria-label={`${pin.length} / ${length}`}>
      {Array.from({ length }, (_, i) => <span key={i} className={`w-3.5 h-3.5 rounded-full transition-colors ${i < pin.length ? 'bg-primary-container' : 'border-2 border-outline'}`} />)}
    </div>}
    {error && <Banner tone="error" icon="lock">{error}{wait > 0 && <> {t(`Sug ${Math.ceil(wait / 1000)} ilbiriqsi.`, `Wait ${Math.ceil(wait / 1000)} s.`)}</>}</Banner>}
    {pinOn ? <div className="grid grid-cols-3 gap-x-6 gap-y-2 w-full max-w-[280px]">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <div key={d}>{key(d, () => press(d), d, 'w-full')}</div>)}
      <div>{bioOn ? key(<Icon name="fingerprint" className="text-[30px] text-primary-container" />, biometric, t('Faraha', 'Fingerprint'), 'w-full') : null}</div>
      <div>{key('0', () => press('0'), '0', 'w-full')}</div>
      <div>{key(<Icon name="backspace" className="text-[26px]" />, () => setPin(p => p.slice(0, -1)), t('Tirtir', 'Delete'), 'w-full')}</div>
    </div> : <Button icon="fingerprint" onClick={biometric} className="min-w-[200px]">{t('Fur Toosh', 'Unlock Toosh')}</Button>}
    {pinOn && <button type="button" onClick={() => setForgot(true)} className="min-h-10 px-4 text-[14.5px] font-bold text-primary-container">{t('Ma ilowday PIN-ka?', 'Forgot your PIN?')}</button>}
    <Sheet open={forgot} onClose={() => setForgot(false)} title={t('Ma ilowday PIN-ka?', 'Forgot your PIN?')}>
      <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t('PIN-ka lama soo celin karo — waxa la kaydiyay waa hash keliya. Ka bax akoonka, kadibna dib ugu gal lambarkaaga iyo furahaaga sirta ah (ama koodh soo celin). PIN-ka waa la tirtiri doonaa; xogtaada server-ka way jirtaa.', 'The PIN cannot be recovered — only a hash is stored. Sign out, then sign in again with your number and password (or a recovery code). The PIN is removed; your data stays safe on the server.')}</p>
      <div className="grid grid-cols-2 gap-2"><Button kind="tonal" onClick={() => setForgot(false)}>{t('Jooji', 'Cancel')}</Button>
        <Button kind="danger" className="!bg-error !text-on-error" onClick={() => { setForgot(false); signOut(); }}>{t('Ka bax', 'Sign out')}</Button></div>
    </Sheet>
  </main>;
}
