import { useEffect, useState } from 'react';
import { formatMsisdn } from '@toosh/shared';
import { Banner, Header, Icon, Main } from '../components/ui.tsx';
import { api, type ApiFailure } from '../lib/api.ts';
import { isNativeAndroid, TooshNative, type Sim } from '../lib/native.ts';
import { goBack, navigate } from '../lib/router.ts';
import { t } from '../lib/i18n.ts';
import { useSession } from '../lib/session.tsx';
import type { EvcNumber } from '../lib/types.ts';

/**
 * Makes this Android phone the source of the account's EVC number(s).
 * On dual-SIM phones the person must pick which SIM receives each number's SMS; Toosh never guesses.
 */
export function SourceSetup() {
  const { me, native, refreshNative, refreshMe } = useSession();
  const [sims, setSims] = useState<Sim[] | null>(null);
  const [choice, setChoice] = useState<Record<string, number | 'none'>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState<EvcNumber | null>(null);
  const [days, setDays] = useState(30);
  const [importResult, setImportResult] = useState<string | null>(null);
  const numbers = me!.evcNumbers;

  async function loadSims() {
    try { const r = await TooshNative.listSims(); setSims(r.sims); } catch { setSims([]); }
  }
  useEffect(() => { if (isNativeAndroid && native?.phoneStatePermission === 'GRANTED') loadSims(); }, [native?.phoneStatePermission]);
  useEffect(() => {
    // Preselect only what is certain: an existing binding, or a single SIM matching a single number.
    const next: Record<string, number | 'none'> = {};
    for (const n of numbers) {
      if (n.sourceDeviceId === me!.device.id && n.simSubscriptionId !== null) next[n.id] = n.simSubscriptionId;
      else if (sims?.length === 1 && numbers.length === 1) next[n.id] = sims[0].subscriptionId;
    }
    setChoice(c => ({ ...next, ...c }));
  }, [sims, numbers, me]);

  if (!isNativeAndroid) return <><Header title={t('Taleefanka Asalka ah', 'Source phone')} back={() => goBack('dejinta')} />
    <Main nav={false}><Banner tone="info" icon="phone_android">{t('Taleefanka asalka ah waa inuu noqdaa taleefan Android ah oo leh SIM-ka EVC Plus iyo app-ka Toosh. Browser-ku wuxuu kaliya noqon karaa aalad kormeer.', 'The source phone must be an Android phone with the EVC Plus SIM and the Toosh app. A browser can only be a viewing device.')}</Banner></Main></>;

  const smsOk = native?.smsPermission === 'GRANTED';
  const phoneOk = native?.phoneStatePermission === 'GRANTED';
  const usedSims = Object.values(choice).filter(v => v !== 'none');
  const duplicateSim = usedSims.length !== new Set(usedSims).size;
  const ready = smsOk && phoneOk && sims !== null && numbers.some(n => choice[n.id] !== undefined && choice[n.id] !== 'none') && !duplicateSim;

  async function bind(force: EvcNumber | null = null) {
    setBusy(true); setError(null);
    try {
      for (const n of numbers) {
        const pick = choice[n.id];
        if (pick === undefined || pick === 'none') continue;
        const sim = sims!.find(s => s.subscriptionId === pick)!;
        try {
          await api(`/evc-numbers/${n.id}/source`, { method: 'POST', body: { simSubscriptionId: sim.subscriptionId, simSlot: sim.simSlot, simLabel: `SIM ${sim.simSlot + 1}${sim.carrierName ? ` · ${sim.carrierName}` : ''}`, replace: force?.id === n.id } });
        } catch (e) {
          if ((e as ApiFailure).code === 'SOURCE_EXISTS' && force?.id !== n.id) { setReplace(n); return; }
          throw e;
        }
      }
      await refreshMe();
      const fresh = await api<{ evcNumbers: EvcNumber[]; device: { id: string }; account: { id: string } }>('/me');
      const mappings = fresh.evcNumbers.filter(n => n.sourceDeviceId === fresh.device.id).map(n => ({ subscriptionId: n.simSubscriptionId, simSlot: n.simSlot, evcNumberId: n.id, accountId: fresh.account.id }));
      await TooshNative.setSourceMappings({ mappings, strictFilter: native?.strictFilter ?? true });
      await refreshNative();
    } catch (e) { setError((e as ApiFailure).message); }
    finally { setBusy(false); }
  }
  async function runImport() {
    setError(null); setImportResult(null);
    const p = await TooshNative.requestReadSmsPermission();
    if (p.state !== 'GRANTED') { setError(t('Ogolaanshaha akhrinta fariimihii hore lama bixin. Fariimaha cusub weli waa la soo xareyn doonaa.', 'Permission to read older messages was not given. New messages are still recorded.')); return; }
    setBusy(true);
    try {
      const r = await TooshNative.startInitialImport({ days });
      setImportResult(t(`${r.scanned} fariimood ayaa la eegay: ${r.queued} EVC Plus ah ayaa la kaydiyay, ${r.duplicates} horay ayay u jireen.`, `${r.scanned} messages checked: ${r.queued} EVC Plus saved, ${r.duplicates} already there.`));
      await refreshNative();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const bound = numbers.filter(n => n.sourceDeviceId === me!.device.id);
  const step = (n: number, done: boolean, title: string, body: React.ReactNode) => <section className="card p-4 flex flex-col gap-3.5">
    <div className="flex items-center gap-3"><div className={`w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-extrabold shrink-0 ${done ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface'}`}>{done ? <Icon name="check" className="text-[20px]" /> : n}</div>
      <h2 className="text-[16.5px] font-bold text-on-surface">{title}</h2>{done && <span className="ml-auto min-h-6 py-0.5 px-2.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[11.5px] font-bold flex items-center leading-tight">Diyaar</span>}</div>{body}</section>;

  return <>
    <Header title={t('Taleefanka Asalka ah', 'Source phone')} back={() => goBack('dejinta')} />
    <Main nav={false}>
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      {step(1, smsOk, t('Ogolaanshaha helitaanka SMS', 'SMS receive permission'), <>
        <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t('Toosh wuxuu u baahan yahay inuu helo fariimaha cusub si uu u kaydiyo kuwa EVC Plus. Fariimaha kale lama kaydiyo, lamana diro. Toosh weligii ma weydiiyo PIN-ka EVC.', 'Toosh needs to receive new messages to save the EVC Plus ones. Other messages are never stored or sent. Toosh never asks for your EVC PIN.')}</p>
        {!smsOk && <button onClick={async () => { native?.smsPermission === 'PERMANENTLY_DENIED' ? await TooshNative.openAppSettings() : await TooshNative.requestSmsPermission(); await refreshNative(); }} className="min-h-[52px] py-2 rounded-2xl bg-primary-container text-on-primary text-[16px] font-bold pressable shadow-[0_6px_16px_-6px_rgba(10,107,63,0.55)] leading-tight">{native?.smsPermission === 'PERMANENTLY_DENIED' ? t('Ka fur Settings-ka', 'Open settings') : t('Bixi Ogolaanshaha SMS', 'Allow SMS access')}</button>}
      </>)}
      {step(2, phoneOk && sims !== null, t('Aqoonsiga SIM-ka', 'SIM identification'), <>
        <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t('Taleefannada laba SIM leh, Toosh wuxuu u baahan yahay inuu ogaado SIM-ka fariin kasta timid si fariimaha lambarada kala duwan aysan isugu darsamin.', 'On dual-SIM phones Toosh needs to know which SIM each message came to, so different numbers are not mixed.')}</p>
        {!phoneOk && <button onClick={async () => { native?.phoneStatePermission === 'PERMANENTLY_DENIED' ? await TooshNative.openAppSettings() : await TooshNative.requestPhoneStatePermission(); await refreshNative(); }} className="min-h-[52px] py-2 rounded-2xl bg-primary-container text-on-primary text-[16px] font-bold pressable shadow-[0_6px_16px_-6px_rgba(10,107,63,0.55)] leading-tight">{t('Oggolow aqoonsiga SIM-ka', 'Allow SIM identification')}</button>}
        {phoneOk && sims?.length === 0 && <Banner tone="warn" icon="sim_card_alert">{t('SIM firfircoon lama helin. Geli SIM-ka EVC Plus, kadib', 'No active SIM found. Insert the EVC Plus SIM, then')} <button className="underline" onClick={loadSims}>{t('dib u eeg', 'check again')}</button>.</Banner>}
      </>)}
      {step(3, bound.length > 0, t('Dooro SIM-ka lambar kasta', 'Choose the SIM for each number'), <>
        {numbers.map(n => <div key={n.id} className="flex flex-col gap-2">
          <span className="text-[15.5px] font-bold text-on-surface px-1">{formatMsisdn(n.msisdn)} <span className="text-[13px] font-medium text-on-surface-variant">{n.displayName}</span></span>
          <div className="grid gap-2">{(sims ?? []).map(s => {
            const on = choice[n.id] === s.subscriptionId;
            return <button key={s.subscriptionId} type="button" role="radio" aria-checked={on} onClick={() => setChoice(c => ({ ...c, [n.id]: s.subscriptionId }))}
              className={`flex items-center gap-3 min-h-14 py-2 px-4 rounded-2xl border-2 transition-colors pressable ${on ? 'border-primary-container bg-primary-fixed/60' : 'border-transparent bg-surface-container-low'} leading-tight`}>
              <Icon name="sim_card" fill={on} className={on ? 'text-primary-container' : 'text-on-surface-variant'} />
              <span className="flex-1 text-left text-[15px] font-semibold text-on-surface">SIM {s.simSlot + 1} · {s.carrierName ?? s.displayName ?? 'SIM'}</span>
              {s.number && <span className="text-[13px] text-on-surface-variant">{s.number}</span>}
              <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-primary-container' : 'border-2 border-outline-variant'}`}>{on && <Icon name="check" className="text-[16px] text-on-primary" />}</span></button>;
          })}
            {numbers.length > 1 && <button type="button" onClick={() => setChoice(c => ({ ...c, [n.id]: 'none' }))} className={`min-h-11 py-1.5 rounded-2xl text-[14px] font-medium ${choice[n.id] === 'none' ? 'bg-surface-container-high' : 'bg-surface-container-low'} leading-tight`}>{t('Lambarkan taleefankan kuma jiro', 'This number is not in this phone')}</button>}
          </div>
        </div>)}
        {duplicateSim && <p role="alert" className="text-[13px] text-error">{t('Hal SIM laba lambar looma dooran karo.', 'One SIM cannot be chosen for two numbers.')}</p>}
        <button disabled={!ready || busy} onClick={() => bind()} className="min-h-[52px] py-2 rounded-2xl bg-primary-container text-on-primary text-[16px] font-bold pressable shadow-[0_6px_16px_-6px_rgba(10,107,63,0.55)] disabled:opacity-50 leading-tight">{busy ? t('Waa la xirayaa…', 'Connecting…') : t('Ka dhig taleefankan kan asalka ah', 'Make this the source phone')}</button>
        {replace && <Banner tone="warn" icon="swap_horiz">{formatMsisdn(replace.msisdn)} {t('taleefan kale ayaa horay ugu xirnaa. Haddii aad halkan ku xirto, taleefankii hore fariimo cusub uma diri doono lambarkan.', 'is already connected to another phone. If you connect it here, the old phone stops sending new messages for this number.')}
          <div className="flex gap-2 mt-2"><button className="min-h-10 py-1.5 px-4 rounded-full bg-tertiary-container text-on-tertiary font-bold leading-tight" onClick={() => { const r = replace; setReplace(null); bind(r); }}>{t('Haa, beddel', 'Yes, switch')}</button><button className="min-h-10 py-1.5 px-4 rounded-full bg-surface-container-lowest font-bold leading-tight" onClick={() => setReplace(null)}>{t('Maya', 'No')}</button></div></Banner>}
      </>)}
      {step(4, Boolean(native?.importDoneAt), t('Soo deji fariimihii hore (ikhtiyaari)', 'Import older messages (optional)'), <>
        <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t('Toosh wuxuu akhrin karaa fariimaha EVC Plus ee horay taleefanka ugu jiray. Tani waxay u baahan tahay ogolaansho akhrinta SMS. Fariimaha labanlaabka ah mar keliya ayaa la kaydiyaa.', 'Toosh can read EVC Plus messages already on the phone. This needs SMS read permission. Duplicates are saved only once.')}</p>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-full bg-surface-container">{[7, 30, 90].map(d => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`min-h-9 py-1 rounded-full text-[13.5px] font-semibold transition-all ${days === d ? 'bg-surface-container-lowest text-on-surface shadow-[0_1px_4px_rgba(14,26,19,0.14)]' : 'text-on-surface-variant'} leading-tight`}>{d} maalmood</button>)}</div>
        <button disabled={!bound.length || busy} onClick={runImport} className="min-h-[52px] py-2 rounded-2xl bg-surface-container text-on-surface text-[16px] font-bold pressable disabled:opacity-50 leading-tight">{t('Soo deji fariimaha EVC Plus', 'Import EVC Plus messages')}</button>
        {importResult && <Banner tone="ok" icon="task_alt">{importResult}</Banner>}
      </>)}
      <button onClick={() => navigate('guud')} className="min-h-[52px] py-2 rounded-2xl bg-inverse-surface text-inverse-on-surface text-[16px] font-bold pressable mb-2 leading-tight">{bound.length ? t('Dhammaystiran — u gudub Guud', 'Done — go to Home') : t('Hadda ka bood', 'Skip for now')}</button>
    </Main>
  </>;
}
