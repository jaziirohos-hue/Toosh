import { useEffect, useState } from 'react';
import { normalizeSomaliMsisdn } from '@toosh/shared';
import { Banner, Icon, Logo, Toggle } from '../components/ui.tsx';
import type { ApiFailure } from '../lib/api.ts';
import { isNativeAndroid, TooshNative, type PermissionState } from '../lib/native.ts';
import { navigate } from '../lib/router.ts';
import { deviceDescriptor, useSession } from '../lib/session.tsx';

export function Auth() {
  const { signIn, signedOutReason, native, refreshNative } = useSession();
  const [tab, setTab] = useState<'register' | 'login'>('register');
  const [usePairing, setUsePairing] = useState(false);
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
    if (tab === 'login' && usePairing) {
      if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code.trim())) errs.code = 'Geli koodka 8-da xaraf ah (sida K7QM-4XPA).';
    } else {
      if (tab === 'register' && !name.trim()) errs.displayName = 'Geli magacaaga buuxa.';
      if (!normalizeSomaliMsisdn(phone).ok) errs.phone = 'Geli lambar EVC Plus oo sax ah (sida 61 512 3456).';
      if (password.length < 8) errs.password = 'Furaha sirta ah waa inuu ahaadaa ugu yaraan 8 xaraf.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (isNativeAndroid) await TooshNative.setPreferences({ strictFilter: strict }).catch(() => {});
      const me = tab === 'register' ? await signIn('register', { displayName: name.trim(), phone, password })
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

  const fieldErr = (k: string) => errors[k] ? <p role="alert" className="font-body-sm text-body-sm text-error">{errors[k]}</p> : null;
  const tabCls = (on: boolean) => `flex items-center justify-center py-2.5 px-3 rounded-lg font-title-md text-title-md transition-all duration-200 ${on ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant'}`;
  const device = isNativeAndroid ? { title: 'Taleefanka Asalka ah (Source Phone)', sub: native ? `${native.deviceModel} (Android ${native.androidVersion})` : 'Android' } : { title: 'Aalad kormeer (Viewing device)', sub: deviceDescriptor().name };
  const granted = perm === 'GRANTED';

  return <main className="flex-1 flex flex-col w-full max-w-md mx-auto px-margin bg-surface pt-safe pb-safe">
    <form className="flex flex-col w-full pb-8" onSubmit={submit} noValidate>
      <div className="flex flex-col items-center text-center mt-6 mb-6">
        <div className="relative flex items-center justify-center w-20 h-20 mb-3 bg-surface-container-low rounded-2xl shadow-sm overflow-hidden"><Logo className="w-14 h-14" /></div>
        <div className="flex items-center gap-1.5 mb-1"><span className="font-headline-lg-mobile text-headline-lg-mobile text-primary-container tracking-tight">Toosh</span>
          <span className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-ui text-label-ui uppercase tracking-wider">SMS Raadraac</span></div>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-xs">Raad-raaca Fariimaha EVC Plus &amp; Haraaga</p>
      </div>

      <div className="grid grid-cols-2 p-1 mb-5 bg-surface-container rounded-xl" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'register'} className={tabCls(tab === 'register')} onClick={() => { setTab('register'); setErrors({}); }}>Abuur Akoon Cusub</button>
        <button type="button" role="tab" aria-selected={tab === 'login'} className={tabCls(tab === 'login')} onClick={() => { setTab('login'); setErrors({}); }}>Gal Akoonka</button>
      </div>
      {error && <div className="mb-4"><Banner tone="error" icon="error">{error}</Banner></div>}

      <div className="space-y-4 mb-4">
        {tab === 'register' && <div className="flex flex-col gap-1.5">
          <label className="font-title-md text-title-md text-on-surface flex items-center gap-1.5" htmlFor="display-name"><span>Magacaaga Buuxa</span><span className="text-error font-body-sm text-body-sm">*</span></label>
          <div className="relative flex items-center bg-surface-container-lowest rounded-xl shadow-sm focus-within:shadow-md transition-shadow">
            <Icon name="person" className="text-outline pl-3.5 pr-2" />
            <input id="display-name" autoComplete="name" maxLength={120} value={name} onChange={e => setName(e.target.value)} className="w-full py-3.5 pr-4 bg-transparent font-body-lg text-body-lg text-on-surface placeholder:text-outline focus:outline-none" placeholder="Geli magacaaga" />
          </div>{fieldErr('displayName')}
        </div>}
        {tab === 'login' && <button type="button" onClick={() => { setUsePairing(v => !v); setErrors({}); }} className="font-title-md text-body-md text-secondary underline self-start">{usePairing ? 'Ku gal lambar iyo furaha sirta' : 'Kood isku-xir ayaan haystaa'}</button>}
        {tab === 'login' && usePairing ? <div className="flex flex-col gap-1.5">
          <label className="font-title-md text-title-md text-on-surface" htmlFor="pair-code">Koodka isku-xirka</label>
          <div className="relative flex items-center bg-surface-container-lowest rounded-xl shadow-sm"><Icon name="key" className="text-outline pl-3.5 pr-2" />
            <input id="pair-code" autoCapitalize="characters" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" className="w-full py-3.5 pr-4 bg-transparent font-label-numeric-md text-label-numeric-md tracking-widest focus:outline-none" /></div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Koodka waxaa laga helaa Dejinta → "Ku dar aalad kormeer cusub" aaladda horay u gashan.</p>{fieldErr('code')}
        </div> : <>
          <div className="flex flex-col gap-1.5">
            <label className="font-title-md text-title-md text-on-surface flex items-center justify-between" htmlFor="phone-number"><span>Lambarka EVC Plus</span>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-ui text-label-ui"><span className="w-1.5 h-1.5 rounded-full bg-secondary" />Hormuud EVC</span></label>
            <div className="relative flex items-center bg-surface-container-lowest rounded-xl shadow-sm focus-within:shadow-md transition-shadow">
              <div className="flex items-center gap-1 pl-3.5 pr-2.5 select-none"><Icon name="call" className="text-outline" /><span className="font-label-numeric-md text-label-numeric-md text-on-surface font-semibold">SO</span></div>
              <input id="phone-number" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full py-3.5 pr-4 bg-transparent font-label-numeric-md text-label-numeric-md text-on-surface placeholder:text-outline focus:outline-none" placeholder="+252 61 XXX XXXX" />
            </div>{fieldErr('phone')}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-title-md text-title-md text-on-surface" htmlFor="password">Furaha sirta ah (Password)</label>
            <div className="relative flex items-center bg-surface-container-lowest rounded-xl shadow-sm focus-within:shadow-md transition-shadow"><Icon name="lock" className="text-outline pl-3.5 pr-2" />
              <input id="password" type="password" autoComplete={tab === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full py-3.5 pr-4 bg-transparent font-body-lg text-body-lg focus:outline-none" placeholder="Ugu yaraan 8 xaraf" /></div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Kani waa furaha Toosh. Toosh weligii ma weydiiyo PIN-ka EVC Plus.</p>{fieldErr('password')}
          </div>
        </>}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-container-low text-on-surface-variant">
          <Icon name="info" fill className="text-primary-container shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm leading-relaxed"><strong className="font-semibold text-on-surface">Digniin:</strong> Diiwaangelinta lambarkani kaligeed ma keenayso dhaqdhaqaaqa, taleefanka fariimaha hela ayaa u baahan ogolaansho.</p>
        </div>
      </div>

      <div className="flex flex-col p-4 mb-4 bg-surface-container-lowest rounded-xl shadow-sm">
        <div className="flex items-start gap-3 mb-2.5">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary-fixed text-on-primary-fixed shrink-0"><Icon name="sms" fill className="text-primary-container" /></div>
          <div className="flex flex-col"><h3 className="font-title-md text-title-md text-on-surface">Ogolaanshaha Akhrinta SMS-ka</h3><span className="font-label-ui text-label-ui text-primary-container font-semibold uppercase tracking-wider">Talaabada Ugu Muhiimsan</span></div>
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-4 leading-relaxed">
          {isNativeAndroid ? 'Si Toosh uu si toos ah ugu soo xareeyo fariimaha EVC Plus ee lacagaha baxay iyo kuwa soo galay, fadlan sii ogolaanshaha akhrinta fariimaha taleefankan. Kaliya fariimaha EVC Plus ayaa la keydiyaa; fariimaha kale lama taabto.'
            : 'Ogolaanshaha SMS-ka waxaa la bixiyaa taleefanka Android ee SIM-ka EVC Plus haysta. Aaladdan waxay noqonaysaa aalad kormeer oo arki karta xogta la waafajiyay.'}</p>
        {isNativeAndroid ? <button type="button" onClick={grant} disabled={granted}
          className={`flex items-center justify-center gap-2 w-full py-3 px-4 rounded-lg transition-colors mb-3 group ${granted ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest active:bg-primary-fixed-dim text-on-surface'}`}>
          <Icon name={granted ? 'task_alt' : 'verified_user'} fill className="text-primary-container" />
          <span className="font-title-md text-title-md text-primary font-semibold">{granted ? 'Ogolaanshaha Waa La Siiyay ✓' : perm === 'PERMANENTLY_DENIED' ? 'Ka fur Settings-ka taleefanka' : 'Bixi Ogolaanshaha SMS'}</span>
        </button> : <div className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-lg bg-surface-container text-on-surface-variant mb-3"><Icon name="phone_android" /><span className="font-title-md text-body-md">Taleefanka Android ayaa looga baahan yahay</span></div>}
        {(perm === 'DENIED' || perm === 'PERMANENTLY_DENIED') && <p className="font-body-sm text-body-sm text-error mb-2">Ogolaanshaha waa la diiday. Toosh wuu shaqeyn karaa, laakiin fariimo cusub ma soo xareyn doono ilaa aad oggolaato.</p>}
        <div className="flex items-center justify-between pt-2 gap-3">
          <div className="flex items-center gap-2"><Icon name="filter_alt" className="text-outline text-[18px]" /><span className="font-body-sm text-body-sm text-on-surface font-medium">U ogolow kaliya fariimaha EVCPlus iyo 321</span></div>
          <Toggle label="U ogolow kaliya fariimaha EVCPlus iyo 321" checked={strict} disabled={!isNativeAndroid} onChange={setStrict} />
        </div>
        {isNativeAndroid && !strict && <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">Sidoo kale waa la aqbali doonaa fariimaha calaamadda [-EVCPlus-] leh ee diraha kale ka yimaada. Fariimaha aan EVC ahayn weligood lama keydiyo.</p>}
      </div>

      <div className="flex flex-col p-4 mb-5 bg-surface-container-low rounded-xl">
        <div className="flex items-center justify-between mb-2"><span className="font-label-ui text-label-ui uppercase tracking-wider text-on-surface-variant">Qalabka Xogta Diraya</span>
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-ui text-label-ui"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-primary" /></span>{isNativeAndroid ? (granted ? 'Diyaar' : 'Sugaya ogolaansho') : 'Kormeer'}</span></div>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface-container-lowest text-on-surface shadow-sm"><Icon name={isNativeAndroid ? 'phone_android' : 'laptop_mac'} className="text-primary-container" /></div>
          <div className="flex flex-col min-w-0"><p className="font-title-md text-title-md text-on-surface truncate">{device.title}</p><p className="font-body-sm text-body-sm text-on-surface-variant truncate">{device.sub}</p></div>
        </div>
        <div className="mt-3 pt-2.5 flex items-center justify-between text-on-surface-variant bg-surface-container-lowest/60 rounded-lg px-2.5 py-1.5">
          <div className="flex items-center gap-1.5"><Icon name="sensors" className="text-primary text-[16px]" /><span className="font-body-sm text-body-sm text-on-surface">Xaaladda Fariimaha:</span></div>
          <span className="font-body-sm text-body-sm text-primary font-medium">{navigator.onLine ? 'Khadka ku xiran' : 'Offline'} • {isNativeAndroid ? (granted ? 'Diyaar' : 'Sugaya') : 'Kormeer'}</span>
        </div>
      </div>

      <button type="submit" disabled={busy} id="submit-action-btn" className="flex items-center justify-center gap-2 w-full py-4 px-6 rounded-xl bg-primary-container text-on-primary shadow-md active:bg-primary transition-all duration-200 disabled:opacity-90">
        {busy ? <><Icon name="sync" className="animate-spin text-on-primary" /><span className="font-title-lg text-title-lg text-on-primary font-bold">Xaqiijinaya…</span></>
          : <><span className="font-title-lg text-title-lg text-on-primary font-bold">{tab === 'register' ? 'Ku biir Toosh / Bilow Raadraaca' : 'Gal Akoonka / Fur Toosh'}</span><Icon name="arrow_forward" className="text-on-primary text-[20px]" /></>}
      </button>
      <div className="flex items-center justify-center gap-2 mt-4 text-center px-4"><Icon name="cloud_sync" className="text-outline text-[16px] shrink-0" />
        <p className="font-body-sm text-body-sm text-on-surface-variant">Waxaad akoonkan kaga geli kartaa taleefan kale si aad meel fog ugala socoto dhaqdhaqaaqa.</p></div>
    </form>
  </main>;
}
