import { useEffect, useState } from 'react';
import { normalizeSomaliMsisdn } from '@toosh/shared';
import { Banner, Icon, Logo, Toggle } from '../components/ui.tsx';
import type { ApiFailure } from '../lib/api.ts';
import { isNativeAndroid, TooshNative, type PermissionState } from '../lib/native.ts';
import { navigate } from '../lib/router.ts';
import { deviceDescriptor, useSession } from '../lib/session.tsx';
import { t } from '../lib/i18n.ts';

export function Auth() {
  const { signIn, signedOutReason, native, refreshNative } = useSession();
  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [usePairing, setUsePairing] = useState(false);
  const [recover, setRecover] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(signedOutReason);
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<PermissionState | null>(native?.smsPermission ?? null);
  const [strict, setStrict] = useState(native?.strictFilter ?? true);
  useEffect(() => { if (native) { setPerm(native.smsPermission); setStrict(native.strictFilter); } }, [native]);

  async function grant() {
    // The card above the button is the explanation shown before Android's permission dialog.
    if (perm === 'PERMANENTLY_DENIED') { await TooshNative.openAppSettings(); return; }
    const r = await TooshNative.requestSmsPermission();
    setPerm(r.state); await refreshNative();
  }
  async function submit(e?: React.FormEvent) {
    e?.preventDefault(); setError(null);
    const errs: Record<string, string> = {};
    if (tab === 'login' && recover) {
      if (!normalizeSomaliMsisdn(phone).ok) errs.phone = t('Geli lambar EVC Plus oo sax ah (sida 61 512 3456).', 'Enter a valid EVC Plus number (e.g. 61 512 3456).');
      if (!/^[A-Za-z0-9]{5}[\s-]?[A-Za-z0-9]{5}$/.test(code.trim())) errs.code = t('Geli koodh soo celin 10 xaraf ah (sida K7QM4-XPA2B).', 'Enter a 10-character recovery code (e.g. K7QM4-XPA2B).');
      if (newPassword.length < 8) errs.newPassword = t('Furaha cusub waa ugu yaraan 8 xaraf.', 'The new password needs at least 8 characters.');
    } else if (tab === 'login' && usePairing) {
      if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code.trim())) errs.code = t('Geli koodka 8-da xaraf ah (sida K7QM-4XPA).', 'Enter the 8-character code (e.g. K7QM-4XPA).');
    } else {
      if (tab === 'register' && !name.trim()) errs.displayName = t('Geli magacaaga buuxa.', 'Enter your full name.');
      if (!normalizeSomaliMsisdn(phone).ok) errs.phone = t('Geli lambar EVC Plus oo sax ah (sida 61 512 3456).', 'Enter a valid EVC Plus number (e.g. 61 512 3456).');
      if (password.length < 8) errs.password = t('Furaha sirta ah waa inuu ahaadaa ugu yaraan 8 xaraf.', 'The password needs at least 8 characters.');
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (isNativeAndroid) await TooshNative.setPreferences({ strictFilter: strict }).catch(() => {});
      const me = tab === 'register' ? await signIn('register', { displayName: name.trim(), phone, password })
        : recover ? await signIn('recover', { phone, code: code.trim(), newPassword })
        : usePairing ? await signIn('pair', { code: code.trim() }) : await signIn('login', { phone, password });
      // A new account on an Android phone continues to choosing the SIM; other devices go to the dashboard.
      const needsSource = isNativeAndroid && !me.evcNumbers.some(n => n.sourceDeviceId);
      navigate(needsSource ? 'taleefanka-asalka' : 'guud');
    } catch (err) {
      const f = err as ApiFailure;
      setError(f.message);
      if (f.details && typeof f.details === 'object') setErrors(f.details);
    } finally { setBusy(false); }
  }

  const fieldErr = (k: string) => errors[k] ? <p role="alert" className="text-[13px] text-error px-1">{errors[k]}</p> : null;
  const tabCls = (on: boolean) => `min-h-11 py-1.5 flex items-center justify-center text-center leading-tight px-2 rounded-full text-[14.5px] font-bold transition-all duration-200 ${on ? 'bg-surface-container-lowest text-on-surface shadow-[0_1px_4px_rgba(14,26,19,0.14)]' : 'text-on-surface-variant'}`;
  const device = isNativeAndroid ? { title: t('Taleefanka Asalka ah', 'Source phone'), sub: native ? `${native.deviceModel} (Android ${native.androidVersion})` : 'Android' } : { title: t('Aalad kormeer', 'Viewing device'), sub: deviceDescriptor().name };
  const granted = perm === 'GRANTED';

  return <main className="screen-in flex-1 flex flex-col w-full max-w-md mx-auto px-5 bg-surface pt-safe pb-safe">
    <form className="flex flex-col w-full pb-8" onSubmit={submit} noValidate>
      <div className="flex flex-col items-center text-center mt-10 mb-8">
        <div className="relative flex items-center justify-center w-[88px] h-[88px] mb-4 rounded-[28px] bg-surface-container-lowest shadow-[0_12px_32px_-12px_rgba(5,71,42,0.35)]"><Logo className="w-16 h-16" /></div>
        <h1 className="text-[32px] leading-[1.19] font-extrabold tracking-tight text-on-surface">Toosh</h1>
        <p className="text-[15px] leading-[1.4] text-on-surface-variant mt-1 max-w-xs">{t('Raad-raaca fariimaha EVC Plus iyo haraaga', 'Track your EVC Plus messages and balance')}</p>
        <p className="text-[14px] font-bold text-primary-container mt-1.5">{t('Maamul Qarashaadkaaga Si Fudud.', 'Manage your expenses with ease.')}</p>
      </div>

      <div className="grid grid-cols-2 gap-1 p-1 mb-6 bg-surface-container rounded-full" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'register'} className={tabCls(tab === 'register')} onClick={() => { setTab('register'); setRecover(false); setErrors({}); }}>{t('Akoon Cusub', 'New account')}</button>
        <button type="button" role="tab" aria-selected={tab === 'login'} className={tabCls(tab === 'login')} onClick={() => { setTab('login'); setErrors({}); }}>{t('Gal Akoonka', 'Sign in')}</button>
      </div>
      {error && <div className="mb-5"><Banner tone="error" icon="error">{error}</Banner></div>}

      <div className="space-y-5 mb-5">
        {tab === 'register' && <div className="flex flex-col gap-1.5">
          <label className="px-1 text-[14px] font-bold text-on-surface flex items-center gap-1" htmlFor="display-name"><span>{t('Magacaaga Buuxa', 'Full name')}</span><span className="text-error font-body-sm text-body-sm">*</span></label>
          <div className="relative flex items-center h-14 bg-surface-container-lowest rounded-2xl border border-outline-variant/70 focus-within:border-primary-container focus-within:ring-4 focus-within:ring-primary-fixed transition-all leading-tight">
            <Icon name="person" className="text-on-surface-variant pl-4 pr-2.5" />
            <input id="display-name" autoComplete="name" maxLength={120} value={name} onChange={e => setName(e.target.value)} className="w-full h-full pr-4 bg-transparent text-[16px] text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none" placeholder={t('Geli magacaaga', 'Enter your name')} />
          </div>{fieldErr('displayName')}
        </div>}
        {tab === 'login' && !recover && <button type="button" onClick={() => { setUsePairing(v => !v); setErrors({}); }} className="px-1 text-[14.5px] font-bold text-primary-container self-start">{usePairing ? t('Ku gal lambar iyo furaha sirta', 'Use number and password') : t('Kood isku-xir ayaan haystaa', 'I have a pairing code')}</button>}
        {tab === 'login' && recover ? <>
          <Banner tone="info" icon="key">{t('Geli lambarkaaga, mid ka mid ah koodhadhka soo celinta aad kaydisay, iyo furo cusub. Koodhku hal mar ayuu shaqeeyaa.', 'Enter your number, one of the recovery codes you saved, and a new password. Each code works once.')}</Banner>
          <div className="flex flex-col gap-1.5">
            <label className="px-1 text-[14px] font-bold text-on-surface" htmlFor="phone-number">{t('Lambarka EVC Plus', 'EVC Plus number')}</label>
            <input id="phone-number" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="61 XXX XXXX" className="h-14 px-4 bg-surface-container-lowest rounded-2xl border border-outline-variant/70 text-[16px] font-semibold focus:outline-none focus:border-primary-container" />{fieldErr('phone')}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="px-1 text-[14px] font-bold text-on-surface" htmlFor="recovery-code">{t('Koodhka soo celinta', 'Recovery code')}</label>
            <input id="recovery-code" autoCapitalize="characters" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" className="h-14 px-4 bg-surface-container-lowest rounded-2xl border border-outline-variant/70 text-[18px] font-bold tracking-[0.12em] focus:outline-none focus:border-primary-container" />{fieldErr('code')}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="px-1 text-[14px] font-bold text-on-surface" htmlFor="new-password">{t('Furaha sirta cusub', 'New password')}</label>
            <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('Ugu yaraan 8 xaraf', 'At least 8 characters')} className="h-14 px-4 bg-surface-container-lowest rounded-2xl border border-outline-variant/70 text-[16px] focus:outline-none focus:border-primary-container" />{fieldErr('newPassword')}
          </div>
          <button type="button" onClick={() => { setRecover(false); setErrors({}); setCode(''); }} className="px-1 text-[14.5px] font-bold text-primary-container self-start">{t('Dib ugu noqo galitaanka', 'Back to sign in')}</button>
        </> : tab === 'login' && usePairing ? <div className="flex flex-col gap-1.5">
          <label className="px-1 text-[14px] font-bold text-on-surface" htmlFor="pair-code">{t('Koodka isku-xirka', 'Pairing code')}</label>
          <div className="relative flex items-center h-14 bg-surface-container-lowest rounded-2xl border border-outline-variant/70 focus-within:border-primary-container focus-within:ring-4 focus-within:ring-primary-fixed transition-all leading-tight"><Icon name="key" className="text-on-surface-variant pl-4 pr-2.5" />
            <input id="pair-code" autoCapitalize="characters" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" className="w-full h-full pr-4 bg-transparent text-[18px] font-bold tracking-[0.2em] focus:outline-none" /></div>
          <p className="px-1 text-[13px] leading-[1.38] text-on-surface-variant">{t('Koodka waxaa laga helaa Dejinta → "Ku dar aalad kormeer cusub" aaladda horay u gashan.', 'Get the code on a signed-in device: Settings → "Add a new viewing device".')}</p>{fieldErr('code')}
        </div> : <>
          <div className="flex flex-col gap-1.5">
            <label className="px-1 text-[14px] font-bold text-on-surface flex items-center justify-between" htmlFor="phone-number"><span>{t('Lambarka EVC Plus', 'EVC Plus number')}</span>
              <span className="flex items-center gap-1 min-h-6 py-0.5 px-2.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[11.5px] font-bold leading-tight"><span className="w-1.5 h-1.5 rounded-full bg-primary-container" />Hormuud EVC</span></label>
            <div className="relative flex items-center h-14 bg-surface-container-lowest rounded-2xl border border-outline-variant/70 focus-within:border-primary-container focus-within:ring-4 focus-within:ring-primary-fixed transition-all leading-tight">
              <div className="flex items-center gap-1.5 pl-4 pr-3 mr-2 h-8 select-none border-r border-outline-variant/70"><span className="text-[17px] leading-[1.25]" aria-hidden="true">🇸🇴</span><span className="text-[15px] font-bold text-on-surface">+252</span></div>
              <input id="phone-number" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full h-full pr-4 bg-transparent text-[16px] font-semibold text-on-surface placeholder:text-on-surface-variant/60 placeholder:font-normal focus:outline-none" placeholder="61 XXX XXXX" />
            </div>{fieldErr('phone')}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="px-1 text-[14px] font-bold text-on-surface" htmlFor="password">{t('Furaha sirta ah', 'Password')}</label>
            <div className="relative flex items-center h-14 bg-surface-container-lowest rounded-2xl border border-outline-variant/70 focus-within:border-primary-container focus-within:ring-4 focus-within:ring-primary-fixed transition-all leading-tight"><Icon name="lock" className="text-on-surface-variant pl-4 pr-2.5" />
              <input id="password" type="password" autoComplete={tab === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full h-full pr-4 bg-transparent text-[16px] text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none" placeholder={t('Ugu yaraan 8 xaraf', 'At least 8 characters')} /></div>
            <p className="px-1 text-[13px] leading-[1.38] text-on-surface-variant">{t('Kani waa furaha Toosh. Toosh weligii ma weydiiyo PIN-ka EVC Plus.', 'This is your Toosh password. Toosh never asks for your EVC Plus PIN.')}</p>{fieldErr('password')}
            {tab === 'login' && <button type="button" id="forgotPasswordBtn" onClick={() => { setRecover(true); setUsePairing(false); setErrors({}); setCode(''); }} className="px-1 text-[14px] font-bold text-primary-container self-start">{t('Ma ilowday furaha sirta?', 'Forgot your password?')}</button>}
          </div>
        </>}
        <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-secondary-fixed/70 text-on-secondary-fixed">
          <Icon name="info" className="text-secondary shrink-0 text-[20px]" />
          <p className="text-[13.5px] leading-[1.41]"><strong className="font-semibold text-on-surface">{t('Digniin:', 'Note:')}</strong> {t('Diiwaangelinta lambarkani kaligeed ma keenayso dhaqdhaqaaqa, taleefanka fariimaha hela ayaa u baahan ogolaansho.', 'Registering a number does not bring in activity by itself; the phone that receives the SMS must give permission.')}</p>
        </div>
      </div>

      <div className="card flex flex-col p-4 mb-4">
        <div className="flex items-start gap-3 mb-2.5">
          <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-primary-fixed shrink-0"><Icon name="sms" fill className="text-primary-container" /></div>
          <div className="flex flex-col"><h3 className="text-[16px] font-bold text-on-surface">{t('Ogolaanshaha Akhrinta SMS-ka', 'SMS read permission')}</h3><span className="text-[12px] text-primary-container font-bold">{t('Talaabada ugu muhiimsan', 'The most important step')}</span></div>
        </div>
        <p className="text-[13.5px] leading-[1.48] text-on-surface-variant mb-4">
          {isNativeAndroid ? t('Si Toosh uu si toos ah ugu soo xareeyo fariimaha EVC Plus ee lacagaha baxay iyo kuwa soo galay, fadlan sii ogolaanshaha akhrinta fariimaha taleefankan. Kaliya fariimaha EVC Plus ayaa la keydiyaa; fariimaha kale lama taabto.', 'To record EVC Plus payments in and out automatically, allow Toosh to read SMS on this phone. Only EVC Plus messages are stored; other messages are never touched.')
            : t('Ogolaanshaha SMS-ka waxaa la bixiyaa taleefanka Android ee SIM-ka EVC Plus haysta. Aaladdan waxay noqonaysaa aalad kormeer oo arki karta xogta la waafajiyay.', 'SMS permission is given on the Android phone with the EVC Plus SIM. This device becomes a viewing device that sees the synced data.')}</p>
        {isNativeAndroid ? <button type="button" onClick={grant} disabled={granted}
          className={`flex items-center justify-center gap-2 w-full min-h-12 py-2 px-4 rounded-2xl transition-colors mb-3 pressable ${granted ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-primary-container text-on-primary'} leading-tight`}>
          <Icon name={granted ? 'task_alt' : 'verified_user'} fill className={granted ? 'text-primary-container' : 'text-on-primary'} />
          <span className="text-[15px] font-bold">{granted ? t('Ogolaanshaha Waa La Siiyay ✓', 'Permission granted ✓') : perm === 'PERMANENTLY_DENIED' ? t('Ka fur Settings-ka taleefanka', 'Open phone settings') : t('Bixi Ogolaanshaha SMS', 'Allow SMS access')}</span>
        </button> : <div className="flex items-center justify-center gap-2 w-full min-h-12 py-2 px-4 rounded-2xl bg-surface-container-low text-on-surface-variant mb-3 leading-tight"><Icon name="phone_android" className="text-[20px]" /><span className="text-[14px] font-semibold">{t('Taleefanka Android ayaa looga baahan yahay', 'Needs the Android phone')}</span></div>}
        {(perm === 'DENIED' || perm === 'PERMANENTLY_DENIED') && <p className="text-[13px] text-error mb-2">{t('Ogolaanshaha waa la diiday. Toosh wuu shaqeyn karaa, laakiin fariimo cusub ma soo xareyn doono ilaa aad oggolaato.', 'Permission was denied. Toosh still works, but new messages are not recorded until you allow it.')}</p>}
        <div className="flex items-center justify-between pt-3 gap-3 border-t border-outline-variant/40">
          <div className="flex items-center gap-2"><Icon name="filter_alt" className="text-on-surface-variant text-[19px]" /><span className="text-[14px] text-on-surface font-medium">{t('U ogolow kaliya fariimaha EVCPlus iyo 321', 'Only accept EVCPlus and 321 messages')}</span></div>
          <Toggle label={t('U ogolow kaliya fariimaha EVCPlus iyo 321', 'Only accept EVCPlus and 321 messages')} checked={strict} disabled={!isNativeAndroid} onChange={setStrict} />
        </div>
        {isNativeAndroid && !strict && <p className="text-[13px] leading-[1.38] text-on-surface-variant mt-2">{t('Sidoo kale waa la aqbali doonaa fariimaha calaamadda [-EVCPlus-] leh ee diraha kale ka yimaada. Fariimaha aan EVC ahayn weligood lama keydiyo.', 'Messages marked [-EVCPlus-] from other senders are also accepted. Non-EVC messages are never stored.')}</p>}
      </div>

      <div className="flex items-center gap-3 px-4 py-3 mb-6 rounded-2xl bg-surface-container-low">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-lowest"><Icon name={isNativeAndroid ? 'phone_android' : 'laptop_mac'} className="text-primary-container text-[20px]" /></div>
        <div className="flex-1 min-w-0"><p className="text-[14.5px] leading-snug font-bold text-on-surface break-words">{device.title}</p><p className="text-[12.5px] leading-snug text-on-surface-variant break-words">{device.sub}</p></div>
        <span className="flex items-center gap-1.5 min-h-6 py-0.5 px-2.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[11.5px] font-bold shrink-0 leading-tight"><span className="w-1.5 h-1.5 rounded-full bg-primary-container" />{isNativeAndroid ? (granted ? t('Diyaar', 'Ready') : t('Sugaya', 'Waiting')) : t('Kormeer', 'Viewer')}</span>
      </div>

      <button type="submit" disabled={busy} id="submit-action-btn" className="flex items-center justify-center gap-2 w-full min-h-14 py-2 px-6 rounded-2xl bg-primary-container text-on-primary shadow-[0_10px_24px_-10px_rgba(10,107,63,0.7)] pressable disabled:opacity-80 leading-tight">
        {busy ? <><Icon name="sync" className="animate-spin text-on-primary" /><span className="text-[16.5px] font-bold">{t('Xaqiijinaya…', 'Checking…')}</span></>
          : <><span className="text-[16.5px] font-bold">{tab === 'register' ? t('Ku biir Toosh', 'Join Toosh') : recover ? t('Beddel furaha oo gal', 'Reset password and sign in') : t('Fur Toosh', 'Open Toosh')}</span><Icon name="arrow_forward" className="text-on-primary text-[20px]" /></>}
      </button>
      <div className="flex items-start justify-center gap-2 mt-5 text-center px-4"><Icon name="devices" className="text-on-surface-variant text-[17px] shrink-0" />
        <p className="text-[13px] leading-[1.38] text-on-surface-variant">{t('Waxaad akoonkan kaga geli kartaa taleefan kale si aad meel fog ugala socoto dhaqdhaqaaqa.', 'You can sign in to this account on another phone to follow activity from anywhere.')}</p></div>
    </form>
  </main>;
}
