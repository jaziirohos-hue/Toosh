import { useEffect, useState } from 'react';
import { api, type ApiFailure } from '../lib/api.ts';
import { t } from '../lib/i18n.ts';
import { isNativeAndroid, TooshNative } from '../lib/native.ts';
import { checkPin, clearPin, hasPin, setPin, validPin } from '../lib/pin.ts';
import { useSession } from '../lib/session.tsx';
import { Field, INPUT, offlineAware } from './finance.tsx';
import { Banner, Button, Group, GroupLabel, Icon, Sheet, Toggle } from './ui.tsx';

export function SettingRow({ icon, iconCls = 'bg-primary-fixed text-on-primary-fixed-variant', title, sub, children, onClick, id }: {
  icon: string; iconCls?: string; title: string; sub?: string; children?: React.ReactNode; onClick?: () => void; id?: string;
}) {
  const body = <>
    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconCls}`}><Icon name={icon} className="text-[20px]" /></div>
    <div className="flex-1 min-w-0"><div className="text-[15.5px] font-semibold text-on-surface break-words">{title}</div>{sub && <div className="text-[13px] text-on-surface-variant break-words">{sub}</div>}</div>
    {children ?? (onClick ? <Icon name="chevron_right" className="text-on-surface-variant" /> : null)}
  </>;
  return onClick ? <button id={id} type="button" onClick={onClick} className="w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-surface-container-low transition-colors">{body}</button>
    : <div className="px-4 py-3.5 flex items-center gap-3">{body}</div>;
}

/** Bottom sheet with one choice per row. */
export function ChoiceSheet<T extends string | number>({ title, value, options, onPick, onClose }: { title: string; value: T; options: [T, string, string?][]; onPick: (v: T) => void; onClose: () => void }) {
  return <Sheet open onClose={onClose} title={title}>
    {options.map(([v, label, sub]) => <button key={String(v)} type="button" onClick={() => { onPick(v); onClose(); }}
      className={`flex items-center justify-between gap-3 min-h-14 py-2 px-4 rounded-2xl text-left pressable leading-tight ${value === v ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-surface-container-low'}`}>
      <span className="flex flex-col"><span className="text-[16px] font-semibold">{label}</span>{sub && <span className="text-[12.5px] text-on-surface-variant mt-0.5">{sub}</span>}</span>
      {value === v && <Icon name="check_circle" fill />}</button>)}
  </Sheet>;
}

const LOCK_TIMES: [number, string, string][] = [[0, 'Isla markiiba', 'Immediately'], [30, '30 ilbiriqsi', '30 seconds'], [60, '1 daqiiqo', '1 minute'], [300, '5 daqiiqo', '5 minutes']];
const lockTimeLabel = (s: number) => { const o = LOCK_TIMES.find(x => x[0] === s) ?? LOCK_TIMES[1]; return t(o[1], o[2]); };

/** Account, security and look & feel sections of Dejinta. */
export function SettingsSections({ flash, onError }: { flash: (text: string) => void; onError: (text: string | null) => void }) {
  const { me, refreshMe, prefs, setPrefs, native, refreshNative } = useSession();
  const [sheet, setSheet] = useState<null | 'name' | 'password' | 'codes' | 'pin-set' | 'pin-off' | 'lockAfter' | 'language' | 'theme' | 'currency'>(null);
  const pinOn = prefs.appLock && hasPin();
  const close = () => setSheet(null);

  async function setBiometric(on: boolean) {
    onError(null);
    if (on) {
      const r = await TooshNative.authenticate({ title: t('Daar qufulka faraha', 'Turn on fingerprint lock'), subtitle: t('Xaqiiji faraha ama qufulka taleefanka', 'Confirm with fingerprint or screen lock') })
        .catch(() => ({ success: false, error: null }));
      if (!r.success) { onError(t('Lama daarin: taleefanku ma xaqiijin. Hubi in qufulka shaashadda iyo faraha ay taleefanka ku daaran yihiin.', 'Not turned on: the phone could not confirm. Check that a screen lock / fingerprint is set up on the phone.')); return; }
    }
    setPrefs({ lock: on });
  }
  async function setNativePref(p: { notifyNew?: boolean; notifyPending?: boolean }) {
    if (Object.values(p).some(Boolean)) {
      const r = await TooshNative.requestNotificationPermission();
      if (r.state !== 'GRANTED') { onError(t('Ogolaanshaha ogeysiisyada lama bixin. Ka fur Settings-ka taleefanka.', 'Notification permission was not given. Allow it in the phone settings.')); return; }
    }
    await TooshNative.setPreferences(p); await refreshNative();
  }
  const androidOnly = t('App-ka Android oo keliya', 'Android app only');

  return <>
    <GroupLabel>{t('Akoonka', 'Account')}</GroupLabel>
    <Group>
      <SettingRow id="editNameBtn" icon="badge" title={t('Magaca', 'Name')} sub={me!.account.displayName} onClick={() => setSheet('name')} />
      <SettingRow id="changePasswordBtn" icon="password" title={t('Beddel furaha sirta', 'Change password')} sub={t('Furaha aad ku gasho Toosh', 'The password you sign in with')} onClick={() => setSheet('password')} />
      <SettingRow id="recoveryCodesBtn" icon="key" iconCls="bg-tertiary-fixed text-on-tertiary-fixed-variant" title={t('Koodhadhka soo celinta', 'Recovery codes')} sub={t('Haddii aad illowdo furaha sirta', 'In case you forget your password')} onClick={() => setSheet('codes')} />
    </Group>

    <GroupLabel>{t('Amniga', 'Security')}</GroupLabel>
    <Group>
      <SettingRow icon="pin" title={t('PIN-ka app-ka', 'App PIN')} sub={pinOn ? t('Waxaa la weydiinayaa marka app-ka la furo', 'Asked every time the app opens') : t('4-6 lambar, aaladdan oo keliya', '4–6 digits, this device only')}>
        <Toggle label={t('PIN-ka app-ka', 'App PIN')} checked={pinOn} onChange={on => setSheet(on ? 'pin-set' : 'pin-off')} /></SettingRow>
      {pinOn && <SettingRow id="changePinBtn" icon="dialpad" title={t('Beddel PIN-ka', 'Change PIN')} onClick={() => setSheet('pin-set')} />}
      <SettingRow icon="fingerprint" title={t('Faraha / qufulka taleefanka', 'Fingerprint / phone lock')} sub={isNativeAndroid ? t('Ku fur faraha ama wajiga', 'Unlock with fingerprint or face') : androidOnly}>
        <Toggle label={t('Faraha / qufulka taleefanka', 'Fingerprint / phone lock')} checked={isNativeAndroid && prefs.lock} disabled={!isNativeAndroid} onChange={setBiometric} /></SettingRow>
      {(pinOn || (isNativeAndroid && prefs.lock)) && <SettingRow icon="timer" title={t('Qufulka tooska ah', 'Auto-lock')} sub={lockTimeLabel(prefs.lockAfter)} onClick={() => setSheet('lockAfter')} />}
      <SettingRow icon={prefs.hideAmounts ? 'visibility_off' : 'visibility'} iconCls="bg-secondary-fixed text-on-secondary-fixed-variant" title={t('Qari lacagta', 'Hide amounts')} sub={t('Haraaga, dakhliga iyo qarashka waxay noqonayaan ******', 'Balance, income and expenses show as ******')}>
        <Toggle label={t('Qari lacagta', 'Hide amounts')} checked={prefs.hideAmounts} onChange={v => setPrefs({ hideAmounts: v })} /></SettingRow>
    </Group>

    <GroupLabel>{t('Muuqaalka', 'Appearance')}</GroupLabel>
    <Group>
      <SettingRow id="languageBtn" icon="translate" title={t('Luqadda', 'Language')} sub={prefs.language === 'en' ? 'English' : 'Soomaali'} onClick={() => setSheet('language')} />
      <SettingRow id="themeBtn" icon="dark_mode" title={t('Habka iftiinka', 'Theme')} sub={prefs.theme === 'dark' ? t('Mugdi', 'Dark') : prefs.theme === 'light' ? t('Iftiin', 'Light') : t('Sida taleefanka', 'Same as phone')} onClick={() => setSheet('theme')} />
      <SettingRow id="currencyBtn" icon="currency_exchange" title={t('Lacagta caadiga ah', 'Default currency')} sub={prefs.currency === 'SOS' ? t('Shilin Soomaali (SOS)', 'Somali shilling (SOS)') : t('Doollar (USD)', 'US dollar (USD)')} onClick={() => setSheet('currency')} />
    </Group>

    <GroupLabel>{t('Ogeysiisyada', 'Notifications')}</GroupLabel>
    <Group>
      <SettingRow icon="notifications_active" title={t('Ogeysiis fariin cusub', 'New message alert')} sub={isNativeAndroid ? t('Qaddarka waa la qariyaa', 'The amount is hidden') : androidOnly}>
        <Toggle label={t('Ogeysiisyada Fariimaha Cusub', 'New message notifications')} checked={Boolean(native?.notifyNew)} disabled={!isNativeAndroid} onChange={v => setNativePref({ notifyNew: v })} /></SettingRow>
      <SettingRow icon="pending_actions" iconCls="bg-tertiary-fixed text-tertiary-container" title={t('Xusuusin kala saarid', 'Review reminder')} sub={isNativeAndroid ? t('Marka fariin sugaysa timaado', 'When a message needs review') : androidOnly}>
        <Toggle label={t('Digniinta Fariimaha aan la kala saarin', 'Unreviewed message alerts')} checked={Boolean(native?.notifyPending)} disabled={!isNativeAndroid} onChange={v => setNativePref({ notifyPending: v })} /></SettingRow>
      <SettingRow icon="savings" iconCls="bg-error-container text-on-error-container" title={t('Digniinta miisaaniyadda', 'Budget alerts')} sub={t('Gudaha app-ka, marka xadka loo dhowaado ama la dhaafo', 'In the app, when a budget nears or passes its limit')}>
        <Toggle label={t('Digniinta miisaaniyadda', 'Budget alerts')} checked={prefs.budgetAlerts} onChange={v => setPrefs({ budgetAlerts: v })} /></SettingRow>
      <SettingRow icon="offline_pin" iconCls="bg-secondary-fixed text-secondary" title={t('Kaydi xogta offline', 'Keep data offline')} sub={t("Arag xogta marka khadku go'an yahay", 'See your data without internet')}>
        <Toggle label={t('Kaydi xogta offline', 'Keep data offline')} checked={prefs.offlineCopies} onChange={v => setPrefs({ offlineCopies: v })} /></SettingRow>
    </Group>

    {sheet === 'name' && <NameSheet onClose={close} onSaved={async () => { await refreshMe(); flash(t('Magaca waa la beddelay.', 'Name updated.')); }} />}
    {sheet === 'password' && <PasswordSheet onClose={close} onSaved={n => { refreshMe(); flash(n ? t(`Furaha waa la beddelay. ${n} aalad ayaa laga saaray.`, `Password changed. ${n} device(s) signed out.`) : t('Furaha sirta waa la beddelay.', 'Password changed.')); }} />}
    {sheet === 'codes' && <RecoveryCodesSheet onClose={close} />}
    {sheet === 'pin-set' && <PinSheet changing={pinOn} onClose={close} onDone={() => { setPrefs({ appLock: true }); flash(t('PIN-ka waa la kaydiyay.', 'PIN saved.')); }} />}
    {sheet === 'pin-off' && <PinOffSheet onClose={close} onDone={() => { clearPin(); setPrefs({ appLock: false }); flash(t('PIN-ka waa la damiyay.', 'PIN turned off.')); }} />}
    {sheet === 'lockAfter' && <ChoiceSheet title={t('Qufulka tooska ah', 'Auto-lock')} value={prefs.lockAfter} onClose={close} onPick={v => setPrefs({ lockAfter: v })}
      options={LOCK_TIMES.map(([s, so, en]) => [s, t(so, en), t('Ka dib markaad ka baxdo app-ka ama aadan taaban', 'After leaving the app or not touching it')])} />}
    {sheet === 'language' && <ChoiceSheet title={t('Luqadda', 'Language')} value={prefs.language} onClose={close} onPick={v => setPrefs({ language: v })} options={[['so', 'Soomaali'], ['en', 'English']]} />}
    {sheet === 'theme' && <ChoiceSheet title={t('Habka iftiinka', 'Theme')} value={prefs.theme} onClose={close} onPick={v => setPrefs({ theme: v })}
      options={[['system', t('Sida taleefanka', 'Same as phone')], ['light', t('Iftiin', 'Light')], ['dark', t('Mugdi', 'Dark')]]} />}
    {sheet === 'currency' && <ChoiceSheet title={t('Lacagta caadiga ah', 'Default currency')} value={prefs.currency} onClose={close} onPick={v => setPrefs({ currency: v })}
      options={[['USD', t('Doollar (USD)', 'US dollar (USD)'), t('Lacagaha EVC Plus waa USD', 'EVC Plus amounts are USD')], ['SOS', t('Shilin Soomaali (SOS)', 'Somali shilling (SOS)')]]} />}
  </>;
}

function NameSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me } = useSession();
  const [name, setName] = useState(me!.account.displayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!name.trim()) { setError(t('Geli magacaaga.', 'Enter your name.')); return; }
    setBusy(true);
    try { await api('/me', { method: 'PATCH', body: { displayName: name.trim() } }); onSaved(); onClose(); } catch (err) { setError(offlineAware(err)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={t('Beddel magaca', 'Change name')}>
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field label={t('Magacaaga buuxa', 'Full name')} error={error ?? undefined}><input id="profile-name" autoComplete="name" value={name} maxLength={120} onChange={e => setName(e.target.value)} className={INPUT} /></Field>
      <Button disabled={busy} icon="check">{t('Kaydi', 'Save')}</Button>
    </form>
  </Sheet>;
}

function PasswordSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (signedOut: number) => void }) {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const errs: Record<string, string> = {};
    if (!current) errs.currentPassword = t('Geli furaha hadda.', 'Enter your current password.');
    if (next.length < 8) errs.newPassword = t('Ugu yaraan 8 xaraf.', 'At least 8 characters.');
    else if (next !== confirm) errs.confirm = t('Labada furo isma laha.', 'The passwords do not match.');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await api<{ signedOutDevices: number }>('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      onSaved(r.signedOutDevices); onClose();
    } catch (err) {
      const f = err as ApiFailure;
      if (f.details) setErrors(f.details); else setError(offlineAware(err));
    } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={t('Beddel furaha sirta', 'Change password')}>
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      <Field label={t('Furaha hadda', 'Current password')} error={errors.currentPassword}><input id="current-password" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className={INPUT} /></Field>
      <Field label={t('Furaha cusub', 'New password')} error={errors.newPassword} hint={t('Ugu yaraan 8 xaraf', 'At least 8 characters')}><input id="new-password" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className={INPUT} /></Field>
      <Field label={t('Ku celi furaha cusub', 'Repeat new password')} error={errors.confirm}><input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={INPUT} /></Field>
      <p className="px-1 text-[12.5px] leading-[1.36] text-on-surface-variant">{t('Aaladaha kale ee kormeerka waa laga saari doonaa; taleefanka SMS-ka soo dira wuu sii shaqeynayaa.', 'Other viewing devices will be signed out; the phone that sends SMS keeps working.')}</p>
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <Button id="savePasswordBtn" disabled={busy} icon="check">{t('Beddel furaha', 'Change password')}</Button>
    </form>
  </Sheet>;
}

function RecoveryCodesSheet({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ remaining: number; createdAt: string | null } | null>(null);
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { api<{ remaining: number; createdAt: string | null }>('/auth/recovery-codes').then(setStatus).catch(e => setError(offlineAware(e))); }, []);
  async function generate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!password) { setError(t('Geli furahaaga sirta ah.', 'Enter your password.')); return; }
    setBusy(true);
    try { setCodes((await api<{ codes: string[] }>('/auth/recovery-codes', { method: 'POST', body: { password } })).codes); setPassword(''); }
    catch (err) { const f = err as ApiFailure; setError(f.details?.currentPassword ?? offlineAware(err)); } finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(codes!.join('\n')); setCopied(true); } catch { setCopied(false); }
  }
  return <Sheet open onClose={onClose} title={t('Koodhadhka soo celinta', 'Recovery codes')}>
    {codes ? <>
      <Banner tone="warn" icon="warning">{t('Qor ama kaydi koodhadhkan meel ammaan ah HADDA. Mar dambe lama tusi doono. Koodh kasta hal mar ayuu shaqeeyaa.', 'Write these down or save them somewhere safe NOW. They will not be shown again. Each code works once.')}</Banner>
      <div data-testid="recovery-codes" className="grid grid-cols-2 gap-2 p-3 rounded-2xl bg-surface-container-low select-all">
        {codes.map(c => <span key={c} className="sms-text !text-[15px] text-center py-1.5 rounded-lg bg-surface-container-lowest">{c}</span>)}</div>
      <Button kind="tonal" icon={copied ? 'check' : 'content_copy'} onClick={copy}>{copied ? t('Waa la koobiyay', 'Copied') : t('Koobi', 'Copy')}</Button>
      <Button onClick={onClose}>{t('Waan kaydiyay', 'I saved them')}</Button>
    </> : <form onSubmit={generate} className="flex flex-col gap-4">
      <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t('Haddii aad illowdo furaha sirta, ku gal lambarkaaga iyo mid ka mid ah koodhadhkan, kadibna dooro furo cusub.', 'If you forget your password, sign in with your number and one of these codes, then choose a new password.')}</p>
      {status && <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface-container-low">
        <Icon name={status.remaining ? 'verified_user' : 'gpp_maybe'} className={`text-[22px] ${status.remaining ? 'text-primary-container' : 'text-tertiary-container'}`} />
        <span className="text-[14.5px] font-semibold">{status.remaining ? t(`${status.remaining} koodh ayaa haray`, `${status.remaining} codes left`) : t('Weli koodh ma haysatid', 'You have no codes yet')}</span></div>}
      <Field label={t('Furahaaga sirta ah (si loo xaqiijiyo)', 'Your password (to confirm)')}><input id="codes-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={INPUT} /></Field>
      {status?.remaining ? <p className="px-1 text-[12.5px] text-on-surface-variant">{t('Koodhadh cusub ayaa kuwii hore beddelaya.', 'New codes replace the old ones.')}</p> : null}
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <Button id="generateCodesBtn" disabled={busy} icon="key">{status?.remaining ? t('Samee koodhadh cusub', 'Make new codes') : t('Samee koodhadh', 'Make codes')}</Button>
    </form>}
  </Sheet>;
}

/** Set (or change) the app PIN: changing asks for the current PIN first, then the new one twice. */
function PinSheet({ changing, onClose, onDone }: { changing: boolean; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'current' | 'new' | 'confirm'>(changing ? 'current' : 'new');
  const [value, setValue] = useState(''); const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function next(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (step === 'current') {
      setBusy(true);
      const r = await checkPin(value).finally(() => setBusy(false));
      if (!r.ok) { setError(r.waitMs ? t(`Sug ${Math.ceil(r.waitMs / 1000)} ilbiriqsi.`, `Wait ${Math.ceil(r.waitMs / 1000)} s.`) : t('PIN-ku waa khalad.', 'Wrong PIN.')); setValue(''); return; }
      setStep('new'); setValue(''); return;
    }
    if (!validPin(value)) { setError(t('PIN-ku waa 4 ilaa 6 lambar.', 'The PIN must be 4 to 6 digits.')); return; }
    if (step === 'new') {
      if (/^(\d)\1+$/.test(value) || '0123456789'.includes(value) || '9876543210'.includes(value)) { setError(t('Dooro PIN aan fududeyn (ha isticmaalin 1111 ama 1234).', 'Choose a harder PIN (not 1111 or 1234).')); return; }
      setFirst(value); setValue(''); setStep('confirm'); return;
    }
    if (value !== first) { setError(t('Labada PIN isma laha. Mar kale bilow.', 'The PINs do not match. Start again.')); setValue(''); setFirst(''); setStep('new'); return; }
    setBusy(true);
    try { await setPin(value); onDone(); onClose(); } catch { setError(t('PIN-ka lama kaydin karin aaladdan.', 'The PIN could not be saved on this device.')); } finally { setBusy(false); }
  }
  const title = step === 'current' ? t('Geli PIN-ka hadda', 'Enter current PIN') : step === 'new' ? t('Dooro PIN cusub', 'Choose a new PIN') : t('Ku celi PIN-ka', 'Repeat the PIN');
  return <Sheet open onClose={onClose} title={changing ? t('Beddel PIN-ka', 'Change PIN') : t('Daar PIN-ka', 'Turn on PIN')}>
    <form onSubmit={next} className="flex flex-col gap-4">
      <Field label={title} error={error ?? undefined} hint={step !== 'current' ? t('4-6 lambar. Kaliya aaladdan ayuu ku kaydsan yahay, si qarsoon (hash).', '4–6 digits. Stored only on this device, as a hash.') : undefined}>
        <input id="pin-input" key={step} autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={e => setValue(e.target.value.replace(/\D/g, ''))}
          className={`${INPUT} text-center text-[26px] tracking-[0.5em] font-bold`} /></Field>
      <Button id="pinNextBtn" disabled={busy || value.length < 4} icon={step === 'confirm' ? 'check' : 'arrow_forward'}>{step === 'confirm' ? t('Kaydi PIN-ka', 'Save PIN') : t('Sii wad', 'Continue')}</Button>
    </form>
  </Sheet>;
}

function PinOffSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const r = await checkPin(value);
    if (!r.ok) { setError(r.waitMs ? t(`Sug ${Math.ceil(r.waitMs / 1000)} ilbiriqsi.`, `Wait ${Math.ceil(r.waitMs / 1000)} s.`) : t('PIN-ku waa khalad.', 'Wrong PIN.')); setValue(''); return; }
    onDone(); onClose();
  }
  return <Sheet open onClose={onClose} title={t('Dami PIN-ka', 'Turn off PIN')}>
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('Geli PIN-ka hadda', 'Enter current PIN')} error={error ?? undefined}>
        <input id="pin-off-input" autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={e => setValue(e.target.value.replace(/\D/g, ''))} className={`${INPUT} text-center text-[26px] tracking-[0.5em] font-bold`} /></Field>
      <Button kind="danger" className="!bg-error !text-on-error" disabled={value.length < 4}>{t('Dami', 'Turn off')}</Button>
    </form>
  </Sheet>;
}
