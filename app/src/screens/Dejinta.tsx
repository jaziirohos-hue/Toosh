import { useState } from 'react';
import { formatMsisdn, normalizeSomaliMsisdn } from '@toosh/shared';
import { Banner, Button, Group, GroupLabel, Header, Icon, Main, Sheet, Toggle } from '../components/ui.tsx';
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

  const sourceSeen = source?.lastSeenAt && Date.now() - Date.parse(source.lastSeenAt) < 2 * 3600e3;
  const permText = smsPerm === 'GRANTED' ? 'Waa furan yahay' : smsPerm === 'UNKNOWN' ? 'Weli lama soo sheegin' : 'Waa xiran yahay';
  const permCls = smsPerm === 'GRANTED' ? 'text-primary-container' : smsPerm === 'UNKNOWN' ? 'text-on-surface-variant' : 'text-error';

  return <>
    <Header subtitle="Dejinta" msisdn={account.loginPhone} />
    <Main>
      {toast && <div role="status" className="fixed left-4 right-4 bottom-[calc(max(env(safe-area-inset-bottom,0px),8px)+84px)] z-[60] max-w-md mx-auto px-4 py-3 rounded-2xl bg-inverse-surface text-inverse-on-surface shadow-lg flex items-center gap-2.5 screen-in">
        <Icon name="check_circle" fill className="text-[20px] text-primary-fixed-dim" /><span className="text-[14px] flex-1">{toast}</span>
        <span className="text-[12px] text-inverse-on-surface/70">{timeOfDay(new Date().toISOString(), tz)}</span></div>}
      {error && <Banner tone="error" icon="error">{error}</Banner>}

      <section className="card p-4 flex flex-wrap items-center gap-4">
        <div className="relative shrink-0">
          <div className="w-16 h-16 rounded-full hero-gradient text-on-primary flex items-center justify-center text-[24px] font-extrabold">{initials(account.displayName)}</div>
          <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-surface-container-lowest flex items-center justify-center shadow-sm"><Icon name="verified_user" fill className="text-primary-container text-[16px]" /></div>
        </div>
        <div className="flex-1 min-w-[170px]">
          <h2 className="text-[19px] leading-[1.26] font-extrabold tracking-tight text-on-surface break-words">{account.displayName}</h2>
          <div className="text-[15px] font-semibold text-on-surface-variant mt-0.5 whitespace-nowrap">{formatMsisdn(account.loginPhone)}</div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {/* Registration is not verification: the badge says "registered", never "verified". */}
            <span className="min-h-6 py-0.5 px-2.5 rounded-full bg-surface-container text-on-surface-variant text-[11.5px] font-bold uppercase tracking-wide flex items-center leading-tight">Diiwaangashan</span>
            <span className="text-[12.5px] text-on-surface-variant">{tz}</span>
          </div>
        </div>
      </section>

      <GroupLabel>Taleefanka asalka ah</GroupLabel>
      <Group>
        <div className="p-4 flex items-start gap-3">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${source ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-surface-container text-on-surface-variant'}`}><Icon name={source ? 'mobile_friendly' : 'mobile_off'} className="text-[22px]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-bold text-on-surface break-words">{source ? (source.model ?? source.name) : 'Weli lama xirin'}</div>
            <div className="text-[13px] leading-[1.38] text-on-surface-variant mt-0.5">{source ? (source.current ? 'Taleefankan ayaa SMS-ka soo diraya' : 'Taleefan kale ayaa SMS-ka soo diraya')
              : 'Fur Toosh taleefanka Android ee SIM-ka EVC Plus leh, kadibna ka dhig taleefanka asalka.'}</div>
          </div>
          {source && <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${sourceSeen ? 'bg-primary-container' : 'bg-outline'}`} />}
        </div>
        {source && <>
          <InfoRow icon="sms" label="Ogolaanshaha SMS" value={<span className={`font-semibold ${permCls}`}>{permText}</span>} />
          <InfoRow icon="schedule" label="La xiriiray" value={ago(source.lastSeenAt)} />
          <InfoRow icon="cloud_done" label="Xog la waafajiyay" value={ago(thisIsSource ? native?.lastUploadAt ?? source.lastUploadAt : source.lastUploadAt)} />
          {thisIsSource && native && <InfoRow icon="inbox" label="Safka taleefanka" value={`${native.queue.pending} sugaya · ${native.queue.failed} fashilmay${native.queue.unmatched ? ` · ${native.queue.unmatched} SIM?` : ''}`} />}
          {thisIsSource && native?.lastError && <p className="px-4 py-3 text-[13px] text-error">{native.lastError}</p>}
        </>}
        <div className="p-3 flex flex-col gap-2">
          <Button id="syncNowBtn" icon="sync" spin={syncing} disabled={syncing} onClick={syncNow}>{syncing ? 'Waa la waafajinayaa…' : 'Isku-xir Hadda (Sync Now)'}</Button>
          {isNativeAndroid && <Button kind="tonal" icon="settings_cell" onClick={() => navigate('taleefanka-asalka')}>{thisIsSource ? 'Dejinta SIM-ka iyo fariimihii hore' : 'Ka dhig taleefankan kan asalka ah'}</Button>}
          {thisIsSource && native && (native.queue.failed > 0 || native.authProblem) && <Button kind="danger" icon="replay" onClick={async () => { await TooshNative.retryFailed(); await refreshNative(); }}>Isku day mar kale kuwa fashilmay</Button>}
        </div>
      </Group>

      <GroupLabel>Lambarada EVC Plus</GroupLabel>
      <Group>
        {me!.evcNumbers.map(n => {
          const src = me!.devices.find(d => d.id === n.sourceDeviceId);
          return <div key={n.id} className="px-4 py-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="w-10 h-10 rounded-full bg-secondary-fixed text-secondary flex items-center justify-center shrink-0"><Icon name="sim_card" className="text-[20px]" /></div>
            <div className="flex-1 min-w-[150px]">
              <div className="text-[15.5px] font-bold text-on-surface">{formatMsisdn(n.msisdn)}</div>
              <div className="text-[13px] text-on-surface-variant break-words">{[n.displayName, src ? `${src.model ?? src.name}${n.simLabel ? ` · ${n.simLabel}` : ''}` : 'Taleefan asal ah ma leh'].filter(Boolean).join(' · ')}</div>
            </div>
            <span className="min-h-6 py-0.5 px-2 rounded-full bg-surface-container text-on-surface-variant text-[11.5px] font-semibold flex items-center shrink-0 leading-tight">Lama xaqiijin</span>
          </div>;
        })}
        <ActionRow icon="add" onClick={() => setAddOpen(true)}>Ku dar lambar EVC</ActionRow>
      </Group>
      <p className="px-1 -mt-2 text-[12.5px] leading-[1.36] text-on-surface-variant">Diiwaangelinta lambarku ma keenayso dhaqdhaqaaq — taleefanka asalka ah ee SIM-ka haysta ayaa fariimaha soo dira. Lambarada lama xaqiijin.</p>

      <GroupLabel>Aaladaha kormeerka</GroupLabel>
      <Group>
        {[...(source ? [source] : []), ...viewers].map(d => {
          const online = d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < (d.role === 'SOURCE' ? 75 : 15) * 60000;
          return <div key={d.id} className="px-4 py-3.5 flex items-center gap-3">
            <div className={`relative w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center shrink-0 ${online ? 'text-primary-container' : 'text-on-surface-variant'}`}><Icon name={deviceIcon(d)} className="text-[21px]" />
              <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-surface-container-lowest ${online ? 'bg-primary-container' : 'bg-outline-variant'}`} /></div>
            <div className="flex-1 min-w-0">
              <div className="text-[15.5px] font-semibold text-on-surface break-words">{d.name}</div>
              <div className="text-[13px] text-on-surface-variant">{[d.current ? 'Aaladdan' : null, d.role === 'SOURCE' ? 'Asal' : 'Kormeer', online ? 'Khadka ku jira' : `La arkay ${ago(d.lastSeenAt)}`].filter(Boolean).join(' · ')}</div>
            </div>
            {!d.current && <button aria-label={`Ka saar ${d.name}`} title="Ka saar aaladda" onClick={() => setRevoke(d)} className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant active:bg-error-container active:text-error"><Icon name="link_off" className="text-[20px]" /></button>}
          </div>;
        })}
        <ActionRow id="addDeviceBtn" icon="qr_code_2" onClick={makePairingCode}>Ku dar aalad kormeer cusub</ActionRow>
      </Group>
      <p className="px-1 -mt-2 text-[12.5px] leading-[1.36] text-on-surface-variant">Aaladaha kormeerka waxay arki karaan xogta la waafajiyay oo keliya, ma helaan SMS-ka tooska ah.</p>

      <GroupLabel>Amniga &amp; dookhyada</GroupLabel>
      <Group>
        <PrefRow icon="fingerprint" title="Qufulka PIN ama Faraha" sub={isNativeAndroid ? 'Marka app-ka la furo' : 'App-ka Android oo keliya'}>
          <Toggle label="Qufulka PIN ama Faraha" checked={isNativeAndroid && prefs.lock} disabled={!isNativeAndroid} onChange={setLock} /></PrefRow>
        <PrefRow icon="notifications_active" title="Ogeysiis fariin cusub" sub={isNativeAndroid ? 'Qadarka waa la qariyaa' : 'App-ka Android oo keliya'}>
          <Toggle label="Ogeysiisyada Fariimaha Cusub" checked={Boolean(native?.notifyNew)} disabled={!isNativeAndroid} onChange={v => setNativePref({ notifyNew: v })} /></PrefRow>
        <PrefRow icon="pending_actions" iconCls="bg-tertiary-fixed text-tertiary-container" title="Xusuusin kala saarid" sub={isNativeAndroid ? 'Marka fariin sugaysa timaado' : 'App-ka Android oo keliya'}>
          <Toggle label="Digniinta Fariimaha aan la kala saarin" checked={Boolean(native?.notifyPending)} disabled={!isNativeAndroid} onChange={v => setNativePref({ notifyPending: v })} /></PrefRow>
        <PrefRow icon="offline_pin" iconCls="bg-secondary-fixed text-secondary" title="Kaydi xogta offline" sub="Arag xogta marka khadku go'an yahay">
          <Toggle label="Kaydi xogta offline" checked={prefs.offlineCopies} onChange={v => setPrefs({ offlineCopies: v })} /></PrefRow>
      </Group>

      <Button id="signOutBtn" kind="danger" icon="logout" onClick={() => setConfirmOut(true)} className="mt-2">Ka bax Akoonka (Sign Out)</Button>
      <div className="flex flex-col items-center text-center gap-1 pb-2">
        <span className="text-[13px] font-semibold text-on-surface-variant">Toosh v{native?.appVersion ?? '1.2.0'} · {isNativeAndroid ? 'Android' : 'Web'}</span>
        <span className="text-[12px] text-on-surface-variant/80">Toosh weligii ma weydiiyo PIN-ka EVC Plus.</span>
      </div>
    </Main>

    <Sheet open={Boolean(pairing)} onClose={() => setPairing(null)} title="Ku dar aalad kormeer">
      <p className="text-[14px] leading-[1.43] text-on-surface-variant">Aaladda cusub ka fur Toosh, dooro <strong>Gal Akoonka</strong> → <strong>Kood isku-xir</strong>, kadib geli koodkan. Wuxuu shaqeynayaa hal mar, 10 daqiiqo gudahood.</p>
      <div className="text-center text-[34px] leading-[1.18] font-extrabold tracking-[0.18em] text-primary py-5 bg-primary-fixed/60 rounded-2xl select-all" data-testid="pairing-code">{pairing?.code}</div>
      <p className="text-[14px] leading-[1.43] text-on-surface-variant">Ama ku gal lambarka {masked(account.loginPhone)} iyo furahaaga sirta ah.</p>
    </Sheet>
    <Sheet open={Boolean(revoke)} onClose={() => setRevoke(null)} title="Ka saar aaladda?">
      <p className="text-[14px] leading-[1.43] text-on-surface-variant"><strong className="text-on-surface">{revoke?.name}</strong> waa laga saari doonaa akoonka, wuuna ka bixi doonaa isla markiiba.{revoke?.role === 'SOURCE' ? ' Taleefankani wuxuu ahaa taleefanka asalka ah: fariimo cusub lama soo diri doono ilaa taleefan kale la xiro.' : ''}</p>
      <div className="grid grid-cols-2 gap-2"><Button kind="tonal" onClick={() => setRevoke(null)}>Jooji</Button>
        <Button kind="danger" onClick={() => revoke && doRevoke(revoke)} className="!bg-error !text-on-error">Ka saar</Button></div>
    </Sheet>
    <Sheet open={confirmOut} onClose={() => setConfirmOut(false)} title="Ka bax akoonka?">
      <p className="text-[14px] leading-[1.43] text-on-surface-variant">Ma hubtaa inaad ka baxayso akoonka Toosh? {thisIsSource ? 'Taleefankan waa taleefanka asalka ah: fariimaha cusub lama diri doono inta aad dib uga soo galayso.' : 'Xogta aaladdan ku kaydsan waa la tirtiri doonaa.'}</p>
      <div className="grid grid-cols-2 gap-2"><Button kind="tonal" onClick={() => setConfirmOut(false)}>Jooji</Button>
        <Button kind="danger" onClick={() => { setConfirmOut(false); signOut(); }} className="!bg-error !text-on-error">Ka bax</Button></div>
    </Sheet>
    <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Ku dar lambar EVC Plus">
      <form onSubmit={addNumber} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-on-surface-variant">Lambarka<input type="tel" value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="+252 61 XXX XXXX" className="min-h-[52px] py-2 bg-surface-container-low rounded-2xl px-4 text-[16px] font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container leading-tight" /></label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-on-surface-variant">Magac (ikhtiyaari)<input value={newName} onChange={e => setNewName(e.target.value)} maxLength={80} placeholder="Dukaanka" className="min-h-[52px] py-2 bg-surface-container-low rounded-2xl px-4 text-[16px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container leading-tight" /></label>
        {numberError && <p role="alert" className="text-[13px] text-error">{numberError}</p>}
        <Button>Kaydi</Button>
      </form>
    </Sheet>
  </>;
}

function PrefRow({ icon, iconCls = 'bg-primary-fixed text-on-primary-fixed-variant', title, sub, children }: { icon: string; iconCls?: string; title: string; sub: string; children: React.ReactNode }) {
  return <div className="px-4 py-3.5 flex items-center gap-3">
    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconCls}`}><Icon name={icon} className="text-[20px]" /></div>
    <div className="flex-1 min-w-0"><div className="text-[15.5px] font-semibold text-on-surface">{title}</div><div className="text-[13px] text-on-surface-variant">{sub}</div></div>
    {children}
  </div>;
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-0.5">
    <Icon name={icon} className="text-[20px] text-on-surface-variant shrink-0" />
    <span className="flex-1 text-[14.5px] text-on-surface whitespace-nowrap">{label}</span>
    <span className="ml-auto text-[14px] text-on-surface-variant text-right">{value}</span>
  </div>;
}

function ActionRow({ icon, children, onClick, id }: { icon: string; children: React.ReactNode; onClick: () => void; id?: string }) {
  return <button id={id} type="button" onClick={onClick} className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-surface-container-low transition-colors">
    <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary flex items-center justify-center shrink-0"><Icon name={icon} className="text-[20px]" /></div>
    <span className="flex-1 text-[15.5px] font-bold text-primary-container">{children}</span><Icon name="chevron_right" className="text-on-surface-variant" />
  </button>;
}
