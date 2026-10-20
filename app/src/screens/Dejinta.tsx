import { useState } from 'react';
import { formatMsisdn, normalizeSomaliMsisdn } from '@toosh/shared';
import { Banner, Header, Icon, Main, Sheet, Toggle } from '../components/ui.tsx';
import { api, type ApiFailure } from '../lib/api.ts';
import { ago, initials, masked, timeOfDay } from '../lib/format.ts';
import { isNativeAndroid, TooshNative } from '../lib/native.ts';
import { navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll } from '../lib/sync.ts';
import type { Device } from '../lib/types.ts';

const deviceIcon = (d: Device) => d.platform === 'android' ? 'phone_android' : d.platform === 'ios' ? 'phone_iphone' : 'laptop_mac';

export function Dejinta() {
  const { me, tz, native, refreshNative, refreshMe, signOut, prefs, setPrefs } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [revoke, setRevoke] = useState<Device | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newNumber, setNewNumber] = useState(''); const [newName, setNewName] = useState(''); const [numberError, setNumberError] = useState<string | null>(null);
  const account = me!.account;
  const source = me!.devices.find(d => d.role === 'SOURCE') ?? null;
  const thisIsSource = me!.evcNumbers.some(n => n.sourceDeviceId === me!.device.id);
  const viewers = me!.devices.filter(d => d.id !== source?.id);
  const smsPerm = thisIsSource ? (native?.smsPermission === 'GRANTED' ? 'GRANTED' : native ? 'DENIED' : 'UNKNOWN') : source?.smsPermission === 'GRANTED' ? 'GRANTED' : source?.smsPermission === 'DENIED' ? 'DENIED' : 'UNKNOWN';
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3000); };

  async function syncNow() {
    setSyncing(true); setError(null);
    try {
      if (isNativeAndroid && thisIsSource) await TooshNative.syncNow();
      await Promise.all([refreshMe(), refreshNative()]); invalidateAll();
      flash('Dhammaan fariimaha EVC Plus waa la cusbooneysiiyay!');
    } catch (e) { setError((e as ApiFailure).message); }
    finally { setSyncing(false); }
  }
  async function makePairingCode() {
    setError(null);
    try { setPairing(await api('/devices/pairing-code', { method: 'POST' })); } catch (e) { setError((e as ApiFailure).message); }
  }
  async function doRevoke(d: Device) {
    setRevoke(null);
    try { await api(`/devices/${d.id}`, { method: 'DELETE' }); await refreshMe(); flash(`${d.name} waa laga saaray.`); }
    catch (e) { setError((e as ApiFailure).message); }
  }
  async function setLock(on: boolean) {
    if (on) {
      const r = await TooshNative.authenticate({ title: 'Daar qufulka Toosh', subtitle: 'Xaqiiji faraha ama PIN-ka taleefanka' }).catch(() => ({ success: false, error: 'Lama heli karo' }));
      if (!r.success) { setError('Qufulka lama daarin: taleefanku ma xaqiijin faraha/PIN-ka. Hubi in qufulka shaashadda uu daaran yahay.'); return; }
    }
    setPrefs({ lock: on });
  }
  async function setNativePref(p: { notifyNew?: boolean; notifyPending?: boolean }) {
    if (Object.values(p).some(Boolean)) {
      const r = await TooshNative.requestNotificationPermission();
      if (r.state !== 'GRANTED') { setError('Ogolaanshaha ogeysiisyada lama bixin. Ka fur Settings-ka taleefanka.'); return; }
    }
    await TooshNative.setPreferences(p); await refreshNative();
  }
  async function addNumber(e: React.FormEvent) {
    e.preventDefault(); setNumberError(null);
    const p = normalizeSomaliMsisdn(newNumber);
    if (!p.ok) { setNumberError('Geli lambar EVC Plus oo sax ah (sida 61 512 3456).'); return; }
    try { await api('/evc-numbers', { method: 'POST', body: { msisdn: p.e164, displayName: newName.trim() || null } }); setAddOpen(false); setNewNumber(''); setNewName(''); await refreshMe(); }
    catch (err) { setNumberError((err as ApiFailure).message); }
  }

  return <>
    <Header subtitle="Dejinta" msisdn={account.loginPhone} />
    <Main>
      {toast && <div role="status" className="p-3 rounded-xl bg-primary text-on-primary shadow-md flex items-center justify-between">
        <div className="flex items-center gap-2"><Icon name="verified" className="text-[20px] text-primary-fixed" /><span className="font-body-sm text-body-sm">{toast}</span></div>
        <span className="font-label-numeric-sm text-label-numeric-sm text-primary-fixed-dim">{timeOfDay(new Date().toISOString(), tz)}</span></div>}
      {error && <Banner tone="error" icon="error">{error}</Banner>}

      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-3 relative overflow-hidden">
        <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-primary-fixed/20 rounded-full blur-xl pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-headline-md text-headline-md shadow-sm">{initials(account.displayName)}</div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-surface-container-lowest flex items-center justify-center shadow-sm"><Icon name="verified_user" fill className="text-primary-container text-[14px]" /></div>
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="font-title-md text-title-md text-on-surface truncate">{account.displayName}</h2>
              {/* Registration is not verification: the badge says "registered", never "verified". */}
              <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-ui text-label-ui uppercase tracking-wider shrink-0">Diiwaangashan</span>
            </div>
            <span className="font-label-numeric-md text-label-numeric-md text-on-surface-variant mt-0.5">{formatMsisdn(account.loginPhone)}</span>
            <span className="font-body-sm text-body-sm text-primary-container font-medium">Akoonka Toosh · {tz}</span>
          </div>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div><span className="font-label-ui text-label-ui text-primary-container uppercase tracking-wider">SMS Source Phone</span><h3 className="font-title-md text-title-md text-on-surface">Taleefanka Asalka ah</h3></div>
          <span className="p-1.5 rounded-lg bg-surface-container-low text-primary-container"><Icon name="phone_android" className="text-[20px]" /></span>
        </div>
        {source ? <div className="p-3 rounded-lg bg-surface-container-low flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2"><span className="font-title-md text-body-md font-semibold text-on-surface truncate">{source.model ?? source.name}</span>
            <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-ui text-label-ui shrink-0">{source.current ? 'Taleefankan' : 'Taleefan kale'}</span></div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <Icon name={smsPerm === 'GRANTED' ? 'check_circle' : smsPerm === 'UNKNOWN' ? 'help' : 'error'} fill className={`text-[18px] ${smsPerm === 'GRANTED' ? 'text-primary-container' : smsPerm === 'UNKNOWN' ? 'text-outline' : 'text-error'}`} />
              <span className="font-body-sm text-body-sm text-on-surface-variant">Ogolaanshaha SMS:</span></div>
            <span className={`font-body-sm text-body-sm font-medium ${smsPerm === 'GRANTED' ? 'text-primary-container' : smsPerm === 'UNKNOWN' ? 'text-on-surface-variant' : 'text-error'}`}>{smsPerm === 'GRANTED' ? 'Waa furan yahay' : smsPerm === 'UNKNOWN' ? 'Weli lama soo sheegin' : 'Waa xiran yahay'}</span>
          </div>
          <div className="flex items-center justify-between"><div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${source.lastSeenAt && Date.now() - Date.parse(source.lastSeenAt) < 2 * 3600e3 ? 'bg-primary-container animate-pulse' : 'bg-outline'}`} /><span className="font-body-sm text-body-sm text-on-surface">La xiriiray</span></div>
            <span className="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">{ago(source.lastSeenAt)}</span></div>
          <div className="flex items-center justify-between"><span className="font-body-sm text-body-sm text-on-surface">Xog la waafajiyay</span>
            <span className="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">{ago(thisIsSource ? native?.lastUploadAt ?? source.lastUploadAt : source.lastUploadAt)}</span></div>
          {thisIsSource && native && <div className="flex items-center justify-between"><span className="font-body-sm text-body-sm text-on-surface">Safka taleefanka</span>
            <span className="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">{native.queue.pending} sugaya · {native.queue.failed} fashilmay · {native.queue.unmatched} SIM?</span></div>}
          {thisIsSource && native?.lastError && <p className="font-body-sm text-body-sm text-error">{native.lastError}</p>}
        </div> : <p className="font-body-sm text-body-sm text-on-surface-variant">Weli taleefan asal ah lama xirin. Fur Toosh taleefanka Android ee SIM-ka EVC Plus leh, kadibna ka dhig taleefanka asalka.</p>}
        <button id="syncNowBtn" disabled={syncing} onClick={syncNow} className="w-full h-12 px-4 rounded-lg bg-primary-container active:bg-primary text-on-primary flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-80">
          <Icon name="sync" className={`text-[20px] ${syncing ? 'animate-spin' : ''}`} /><span className="font-title-md text-title-md">{syncing ? 'Waa la waafajinayaa...' : 'Isku-xir Hadda (Sync Now)'}</span></button>
        {isNativeAndroid && <button onClick={() => navigate('taleefanka-asalka')} className="w-full h-11 rounded-lg bg-surface-container text-on-surface font-title-md text-body-md flex items-center justify-center gap-2">
          <Icon name="settings_cell" className="text-primary-container text-[20px]" />{thisIsSource ? 'Dejinta SIM-ka iyo fariimihii hore' : 'Ka dhig taleefankan kan asalka ah'}</button>}
        {thisIsSource && native && (native.queue.failed > 0 || native.authProblem) && <button onClick={async () => { await TooshNative.retryFailed(); await refreshNative(); }} className="w-full h-11 rounded-lg bg-error-container text-on-error-container font-title-md text-body-md">Isku day mar kale kuwa fashilmay</button>}
        <div className="pt-2 flex items-center justify-between gap-3">
          <div className="flex flex-col min-w-0"><span className="font-body-md text-body-md font-medium text-on-surface">Kaydi xogta offline</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Nuqul ka mid ah xogta la waafajiyay aaladdan ku hay si aad u aragto marka khadku go'an yahay. SMS-ka cusub ee taleefanka asalka had iyo jeer waa la kaydiyaa.</span></div>
          <Toggle label="Kaydi xogta offline" checked={prefs.offlineCopies} onChange={v => setPrefs({ offlineCopies: v })} />
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between"><h3 className="font-title-md text-title-md text-on-surface">Lambarada EVC Plus</h3>
          <span className="px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-numeric-sm text-label-numeric-sm">{me!.evcNumbers.length}</span></div>
        <p className="font-body-sm text-body-sm text-on-surface-variant -mt-1">Diiwaangelinta lambarku ma keenayso dhaqdhaqaaq. Taleefanka asalka ah ee SIM-ka haysta ayaa fariimaha soo dira. Lambarada lama xaqiijin.</p>
        {me!.evcNumbers.map(n => {
          const src = me!.devices.find(d => d.id === n.sourceDeviceId);
          return <div key={n.id} className="p-3 rounded-lg bg-surface-container-low flex items-center justify-between gap-3">
            <div className="flex flex-col min-w-0"><span className="font-label-numeric-md text-label-numeric-md text-on-surface">{formatMsisdn(n.msisdn)}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant truncate">{n.displayName ?? '—'} · {src ? `${src.model ?? src.name}${n.simLabel ? ` · ${n.simLabel}` : ''}` : 'Taleefan asal ah ma leh'}</span></div>
            <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-ui text-label-ui shrink-0">Lama xaqiijin</span>
          </div>;
        })}
        <button onClick={() => setAddOpen(true)} className="w-full h-11 rounded-lg bg-surface-container text-on-surface font-title-md text-body-md flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
          <Icon name="add_circle" className="text-primary-container text-[20px]" /><span>Ku dar lambar EVC</span></button>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-3">
        <div className="flex flex-col">
          <div className="flex items-center justify-between"><h3 className="font-title-md text-title-md text-on-surface">Aaladaha Kale ee Kormeerka</h3>
            <span className="px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-numeric-sm text-label-numeric-sm">{viewers.length} Aaladood</span></div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">Aaladahani waxay kaliya fiirsan karaan xogta la waafajiyay, ma heli karaan SMS-ka tooska ah.</p>
        </div>
        {[...(source ? [source] : []), ...viewers].map(d => {
          const online = d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 15 * 60000;
          return <div key={d.id} className="p-3 rounded-lg bg-surface-container-low flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-full bg-surface-container-lowest flex items-center justify-center shrink-0 shadow-sm ${online ? 'text-primary-container' : 'text-on-surface-variant'}`}><Icon name={deviceIcon(d)} className="text-[20px]" /></div>
              <div className="flex flex-col min-w-0">
                <span className="font-body-md text-body-md font-semibold text-on-surface truncate">{d.name}{d.current ? ' (Aaladdan)' : ''}{d.role === 'SOURCE' ? ' · Asal' : ''}</span>
                <div className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-primary-container' : 'bg-outline'}`} />
                  <span className="font-body-sm text-body-sm text-on-surface-variant truncate">{online ? 'Khadka ku jira' : `Khadka ka maqan (${ago(d.lastSeenAt)})`}</span></div>
              </div>
            </div>
            {!d.current && <button aria-label={`Ka saar ${d.name}`} title="Ka saar aaladda" onClick={() => setRevoke(d)} className="p-2 rounded-lg text-on-surface-variant hover:text-error active:bg-error-container/40 transition-colors"><Icon name="link_off" className="text-[20px]" /></button>}
          </div>;
        })}
        <button id="addDeviceBtn" onClick={makePairingCode} className="w-full h-11 rounded-lg bg-surface-container text-on-surface font-title-md text-body-md flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors">
          <Icon name="add_circle" className="text-primary-container text-[20px]" /><span>Ku dar aalad kormeer cusub</span></button>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-3">
        <h3 className="font-title-md text-title-md text-on-surface">Amniga &amp; Dookhyada</h3>
        <PrefRow icon="fingerprint" title="Qufulka PIN ama Faraha" sub={isNativeAndroid ? 'Biometric lock marka app-ka furmo' : 'Waxaa laga heli karaa app-ka Android'}>
          <Toggle label="Qufulka PIN ama Faraha" checked={isNativeAndroid && prefs.lock} disabled={!isNativeAndroid} onChange={setLock} /></PrefRow>
        <PrefRow icon="notifications_active" title="Ogeysiisyada Fariimaha Cusub" sub={isNativeAndroid ? 'Farriin kasta oo soo gasha ogeysii (qadarka waa la qariyaa)' : 'Waxaa laga heli karaa app-ka Android'}>
          <Toggle label="Ogeysiisyada Fariimaha Cusub" checked={Boolean(native?.notifyNew)} disabled={!isNativeAndroid} onChange={v => setNativePref({ notifyNew: v })} /></PrefRow>
        <PrefRow icon="label_off" iconCls="text-tertiary-container" title="Digniinta Fariimaha aan la kala saarin" sub={isNativeAndroid ? 'Xusuusi marka fariin u baahan kala saarid timaado' : 'Waxaa laga heli karaa app-ka Android'}>
          <Toggle label="Digniinta Fariimaha aan la kala saarin" checked={Boolean(native?.notifyPending)} disabled={!isNativeAndroid} onChange={v => setNativePref({ notifyPending: v })} /></PrefRow>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <button id="signOutBtn" onClick={() => setConfirmOut(true)} className="w-full h-12 px-4 rounded-lg bg-error-container active:bg-error text-on-error-container active:text-on-error font-title-md text-title-md flex items-center justify-center gap-2 shadow-sm transition-colors">
          <Icon name="logout" className="text-[20px]" /><span>Ka bax Akoonka (Sign Out)</span></button>
        <div className="flex flex-col items-center justify-center text-center gap-1 py-2">
          <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">Toosh v{native?.appVersion ?? '1.2.0'} ({isNativeAndroid ? 'Dhisme Android ah' : 'Nooca Web-ka'})</span>
          <span className="font-label-ui text-label-ui text-outline uppercase tracking-wider">{isNativeAndroid ? 'Xogtaada waxay ku kaydsan tahay taleefankaaga' : 'Toosh weligii ma weydiiyo PIN-ka EVC'}</span>
        </div>
      </div>
    </Main>

    <Sheet open={Boolean(pairing)} onClose={() => setPairing(null)} title="Ku dar aalad kormeer">
      <p className="font-body-sm text-body-sm text-on-surface-variant">Aaladda cusub ka fur Toosh, dooro <strong>Gal Akoonka</strong> → <strong>Kood isku-xir</strong>, kadib geli koodkan. Wuxuu shaqeynayaa hal mar, 10 daqiiqo gudahood.</p>
      <div className="text-center font-label-numeric-lg text-headline-lg tracking-widest text-primary py-4 bg-surface-container-low rounded-xl select-all" data-testid="pairing-code">{pairing?.code}</div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">Ama ku gal lambarka {masked(account.loginPhone)} iyo furahaaga sirta ah.</p>
    </Sheet>
    <Sheet open={Boolean(revoke)} onClose={() => setRevoke(null)} title="Ka saar aaladda?">
      <p className="font-body-sm text-body-sm text-on-surface-variant"><strong>{revoke?.name}</strong> waa laga saari doonaa akoonka, wuuna ka bixi doonaa isla markiiba.{revoke?.role === 'SOURCE' ? ' Taleefankani wuxuu ahaa taleefanka asalka ah: fariimo cusub lama soo diri doono ilaa taleefan kale la xiro.' : ''}</p>
      <div className="grid grid-cols-2 gap-2"><button onClick={() => setRevoke(null)} className="h-12 rounded-lg bg-surface-container font-title-md text-body-md">Jooji</button>
        <button onClick={() => revoke && doRevoke(revoke)} className="h-12 rounded-lg bg-error text-on-error font-title-md text-body-md">Ka saar</button></div>
    </Sheet>
    <Sheet open={confirmOut} onClose={() => setConfirmOut(false)} title="Ka bax akoonka?">
      <p className="font-body-sm text-body-sm text-on-surface-variant">Ma hubtaa inaad ka baxayso akoonka Toosh? {thisIsSource ? 'Taleefankan waa taleefanka asalka ah: fariimaha cusub lama diri doono inta aad dib uga soo galayso.' : 'Xogta aaladdan ku kaydsan waa la tirtiri doonaa.'}</p>
      <div className="grid grid-cols-2 gap-2"><button onClick={() => setConfirmOut(false)} className="h-12 rounded-lg bg-surface-container font-title-md text-body-md">Jooji</button>
        <button onClick={() => { setConfirmOut(false); signOut(); }} className="h-12 rounded-lg bg-error text-on-error font-title-md text-body-md">Ka bax</button></div>
    </Sheet>
    <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Ku dar lambar EVC Plus">
      <form onSubmit={addNumber} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 font-title-md text-body-md">Lambarka<input type="tel" value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="+252 61 XXX XXXX" className="bg-surface-container-low rounded-lg px-3 py-2.5 font-label-numeric-md text-label-numeric-md" /></label>
        <label className="flex flex-col gap-1 font-title-md text-body-md">Magac (ikhtiyaari)<input value={newName} onChange={e => setNewName(e.target.value)} maxLength={80} placeholder="Dukaanka" className="bg-surface-container-low rounded-lg px-3 py-2.5 font-body-md text-body-md" /></label>
        {numberError && <p role="alert" className="font-body-sm text-body-sm text-error">{numberError}</p>}
        <button className="h-12 rounded-lg bg-primary-container text-on-primary font-title-md text-title-md">Kaydi</button>
      </form>
    </Sheet>
  </>;
}

function PrefRow({ icon, iconCls = 'text-primary-container', title, sub, children }: { icon: string; iconCls?: string; title: string; sub: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 pt-2 first-of-type:pt-0">
    <div className="flex items-center gap-3 min-w-0"><Icon name={icon} className={`${iconCls} text-[22px] shrink-0`} />
      <div className="flex flex-col min-w-0"><span className="font-body-md text-body-md font-medium text-on-surface truncate">{title}</span><span className="font-body-sm text-body-sm text-on-surface-variant">{sub}</span></div></div>
    {children}
  </div>;
}
