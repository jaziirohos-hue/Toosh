import { useEffect, useState } from 'react';
import { formatMsisdn, localDate, normalizeSomaliSimNumber, providerFromCarrier } from '@toosh/shared';
import { Field, INPUT, LABEL, Segmented, cash, offlineAware } from '../components/finance.tsx';
import { Banner, Button, EmptyState, Floating, Group, Header, Icon, Main, Sheet, Spinner, Toggle, useAmounts } from '../components/ui.tsx';
import { api, qs, type ApiFailure } from '../lib/api.ts';
import { dayLabel } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { isNativeAndroid, TooshNative, type Sim } from '../lib/native.ts';
import { goBack, navigate } from '../lib/router.ts';
import { trackOnThisPhone } from '../lib/sources.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll, useResource } from '../lib/sync.ts';
import type { EvcNumber, SimCard, SimProvider } from '../lib/types.ts';

const providerName = (p: SimProvider) => (p === 'HORMUUD' ? 'Hormuud' : p === 'SOMTEL' ? 'Somtel' : p === 'SOMNET' ? 'Somnet' : p === 'GOLIS' ? 'Golis' : t('Kale', 'Other'));
/** Networks whose mobile-money SMS Toosh reads: Hormuud EVC Plus and Somnet Jeeb. */
const trackable = (p: SimProvider) => p === 'HORMUUD' || p === 'SOMNET';
const walletOf = (p: SimProvider) => (p === 'SOMNET' ? 'Jeeb' : 'EVC Plus');
const providerTone: Record<SimProvider, string> = {
  HORMUUD: 'bg-primary-fixed text-on-primary-fixed-variant', SOMTEL: 'bg-secondary-fixed text-on-secondary-fixed-variant',
  SOMNET: 'bg-error-container text-on-error-container',
  GOLIS: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', OTHER: 'bg-surface-container-high text-on-surface',
};

/** Dejinta → SIM Card: the person's own list of SIM cards. Records are notes; they never switch a real SIM on or off. */
export function SimCards() {
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<'all' | SimProvider>('all');
  const [editing, setEditing] = useState<SimCard | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SimCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [tracking, setTracking] = useState<SimCard | null>(null);
  useEffect(() => { const h = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 3500); return () => clearTimeout(h); }, [toast]);
  const params = { q: query, provider: provider === 'all' ? null : provider };
  const list = useResource<{ simCards: SimCard[]; total: number }>(`sim-cards:${JSON.stringify(params)}`, () => api(`/sim-cards${qs(params)}`));
  const items = list.data?.simCards ?? [];
  const filtered = Boolean(query) || provider !== 'all';

  return <>
    <Header title="SIM Card" back={() => goBack('dejinta')} />
    <Main>
      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-secondary-fixed/70 text-on-secondary-fixed">
        <Icon name="info" className="text-secondary shrink-0 text-[20px]" />
        <p className="text-[13.5px] leading-[1.41]">{t('Halkan ku hay SIM Card-yada aad isticmaasho. Kani waa diiwaan Toosh gudihiisa oo keliya: ku darid, beddelid ama tirtirid ma saameynayso SIM-ka dhabta ah ama adeegga shirkadda.', 'Keep the SIM cards you use here. This is only a record inside Toosh: adding, editing or deleting never affects the real SIM or the network service.')}</p>
      </div>

      <div className="relative flex items-center w-full">
        <Icon name="search" className="absolute left-4 text-on-surface-variant text-[22px] pointer-events-none" />
        <input value={q} onChange={e => setQ(e.target.value)} type="search" aria-label={t('Raadi SIM Card', 'Search SIM cards')} placeholder={t('Raadi magac, lambar ama qoraal', 'Search name, number or notes')}
          className="w-full min-h-12 py-2 pl-12 pr-4 rounded-full bg-surface-container-lowest border border-outline-variant/60 text-on-surface text-[15px] placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary-container leading-tight" />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('Shirkadda', 'Network')}>
        {(['all', 'HORMUUD', 'SOMTEL', 'SOMNET', 'GOLIS', 'OTHER'] as const).map(p => <button key={p} type="button" aria-pressed={provider === p} onClick={() => setProvider(p)}
          className={`min-h-9 py-1 px-3.5 rounded-full text-[13.5px] font-semibold leading-tight pressable ${provider === p ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface'}`}>
          {p === 'all' ? t('Dhammaan', 'All') : providerName(p)}</button>)}
      </div>

      {list.error && !list.data && <Banner tone="error" icon="cloud_off">{offlineAware(list.error)}</Banner>}
      {!list.data && list.loading && <Spinner label={t('SIM Card-yada waa la soo qaadayaa…', 'Loading SIM cards…')} />}
      {list.data && <p className="px-1 -mb-2 text-[13px] font-semibold text-on-surface-variant" data-testid="sim-count">
        {filtered ? t(`${items.length} ka mid ah ${list.data.total} SIM Card`, `${items.length} of ${list.data.total} SIM cards`) : t(`${list.data.total} SIM Card`, `${list.data.total} SIM cards`)}</p>}
      {items.length > 0 && <Group>{items.map(s => <div key={s.id} data-testid="sim-row" className="flex flex-col pb-1"><div className="flex items-center gap-1 pl-4 pr-1.5">
        <button type="button" onClick={() => setEditing(s)} aria-label={`${t('Wax ka beddel', 'Edit')} ${s.name}`} className="flex-1 min-w-0 flex items-center gap-3 py-3.5 text-left active:opacity-70">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 @max-[300px]:hidden ${providerTone[s.provider]}`}><Icon name="sim_card" className="text-[22px]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[15.5px] leading-[1.3] font-semibold text-on-surface break-words">{s.name}</div>
            <div className="text-[13px] leading-[1.38] text-on-surface-variant flex flex-wrap gap-x-1.5"><span className="whitespace-nowrap">{formatMsisdn(s.phone)}</span><span className="whitespace-nowrap">· {providerName(s.provider)}</span></div>
            <div className="text-[12px] leading-[1.33] text-on-surface-variant/90">{t('La diiwaangeliyay', 'Registered')} {dayLabel(`${s.registeredOn}T12:00:00Z`, 'UTC').full}{s.notes ? ` · ${s.notes}` : ''}</div>
          </div>
        </button>
        <button type="button" onClick={() => setDeleting(s)} aria-label={`${t('Tirtir', 'Delete')} ${s.name}`} title={t('Tirtir', 'Delete')}
          className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-error active:bg-error-container"><Icon name="delete" className="text-[22px]" /></button>
      </div><SimMoney sim={s} onTrack={() => setTracking(s)} /></div>)}</Group>}
      {list.data && !items.length && <EmptyState icon="sim_card" title={filtered ? t('SIM Card lama helin', 'No SIM cards found') : t('Weli SIM Card ma jiro', 'No SIM cards yet')}
        text={filtered ? t('Beddel raadinta ama shirkadda.', 'Change the search or network.') : t('Ku dar SIM Card-yada aad isticmaasho si aad meel keliya uga aragto.', 'Add the SIM cards you use to see them in one place.')} />}
      {isNativeAndroid && <Button id="detectSimsBtn" icon="sim_card_download" onClick={() => setDetecting(true)}>{t('Ka soo qaado SIM-yada taleefanka', 'Find SIMs on this phone')}</Button>}
      <Button id="addSimBtn" kind={isNativeAndroid ? 'tonal' : 'primary'} icon="add" onClick={() => setEditing('new')}>{t('Ku dar SIM Card gacan', 'Add SIM card by hand')}</Button>
      {!isNativeAndroid && <p className="px-1 -mt-2 text-[12.5px] leading-[1.36] text-on-surface-variant">{t('SIM-yada si toos ah waxaa looga soo qaadaa app-ka Android ee taleefanka SIM-yadu ku jiraan.', 'SIMs are found automatically in the Android app on the phone that holds them.')}</p>}
    </Main>

    {editing && <SimSheet sim={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
      onSaved={name => { list.reload(); invalidateAll(); setToast(editing === 'new' ? t(`${name} waa la daray.`, `${name} was added.`) : t(`${name} waa la kaydiyay.`, `${name} was saved.`)); }} />}
    {detecting && <DetectSims existing={list.data?.simCards ?? []} onClose={() => setDetecting(false)} onDone={msg => { list.reload(); invalidateAll(); setToast(msg); }} />}
    {tracking && <TrackSim sim={tracking} onClose={() => setTracking(null)} onDone={msg => { list.reload(); invalidateAll(); setToast(msg); }} />}
    {deleting && <DeleteSim sim={deleting} onClose={() => setDeleting(null)} onDeleted={name => { list.reload(); invalidateAll(); setToast(t(`SIM Card-ka "${name}" waa la tirtiray.`, `SIM card "${name}" was deleted.`)); }} />}
    {toast && <Floating><div role="status" data-testid="sim-toast" className="fixed left-4 right-4 bottom-[calc(max(env(safe-area-inset-bottom,0px),8px)+84px)] z-[60] max-w-md mx-auto px-4 py-3 rounded-2xl bg-inverse-surface text-inverse-on-surface shadow-lg flex items-center gap-2.5 screen-in">
      <Icon name="check_circle" fill className="text-[20px] text-primary-fixed-dim" /><span className="text-[14px] flex-1 break-words">{toast}</span></div></Floating>}
  </>;
}

function SimSheet({ sim, onClose, onSaved }: { sim: SimCard | null; onClose: () => void; onSaved: (name: string) => void }) {
  const { tz } = useSession();
  const today = localDate(new Date(), tz);
  const [f, setF] = useState({ name: sim?.name ?? '', phone: sim ? formatMsisdn(sim.phone).replace('+252 ', '') : '', provider: (sim?.provider ?? 'HORMUUD') as SimProvider, registeredOn: sim?.registeredOn ?? today, notes: sim?.notes ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = t('Geli magaca SIM-ka.', 'Enter a name for the SIM.');
    if (!normalizeSomaliSimNumber(f.phone).ok) errs.phone = t('Geli lambar Soomaali ah oo sax ah (sida 61 512 3456).', 'Enter a valid Somali number (e.g. 61 512 3456).');
    if (!f.registeredOn || f.registeredOn > today) errs.registeredOn = t('Taariikhdu ma noqon karto mustaqbalka.', 'The date cannot be in the future.');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { ...f, name: f.name.trim(), notes: f.notes.trim() || null };
    try {
      if (sim) await api(`/sim-cards/${sim.id}`, { method: 'PUT', body }); else await api('/sim-cards', { method: 'POST', body });
      onSaved(body.name); onClose();
    } catch (err) {
      const fl = err as ApiFailure;
      if (fl.details) setErrors(fl.details); else setError(offlineAware(err));
    } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={sim ? t('Wax ka beddel SIM Card', 'Edit SIM card') : t('SIM Card cusub', 'New SIM card')}>
    <form onSubmit={save} noValidate className="flex flex-col gap-4 overflow-y-auto max-h-[calc(72dvh/var(--app-zoom,1))] -mx-1 px-1 pb-1">
      <Field label={t('Magaca SIM-ka', 'SIM card name')} error={errors.name}>
        <input id="sim-name" value={f.name} maxLength={60} onChange={e => setF({ ...f, name: e.target.value })} placeholder={t('Tusaale: SIM-ka shaqada', 'e.g. Work SIM')} className={INPUT} /></Field>
      <Field label={t('Lambarka taleefanka', 'Phone number')} error={errors.phone}>
        <div className="flex items-center gap-2"><span className="text-[15px] font-bold text-on-surface-variant shrink-0">+252</span>
          <input id="sim-phone" type="tel" inputMode="tel" autoComplete="off" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="61 XXX XXXX" className={`${INPUT} font-semibold`} /></div></Field>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Shirkadda isgaarsiinta', 'Network provider')}</span>
        <Segmented label={t('Shirkadda isgaarsiinta', 'Network provider')} value={f.provider} onChange={v => setF({ ...f, provider: v })}
          options={[['HORMUUD', 'Hormuud'], ['SOMTEL', 'Somtel'], ['SOMNET', 'Somnet'], ['GOLIS', 'Golis'], ['OTHER', t('Kale', 'Other')]]} />
        {errors.provider && <span role="alert" className="px-1 text-[13px] text-error">{errors.provider}</span>}</div>
      <Field label={t('Taariikhda diiwaangelinta', 'Registration date')} error={errors.registeredOn}>
        <input id="sim-date" type="date" value={f.registeredOn} max={today} onChange={e => setF({ ...f, registeredOn: e.target.value })} className={INPUT} /></Field>
      <Field label={t('Qoraal (ikhtiyaari)', 'Notes (optional)')} error={errors.notes}>
        <textarea id="sim-notes" value={f.notes} maxLength={500} rows={2} onChange={e => setF({ ...f, notes: e.target.value })} className={`${INPUT} resize-none py-3`} /></Field>
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <Button id="saveSimBtn" disabled={busy} icon="check">{t('Kaydi SIM Card', 'Save SIM card')}</Button>
    </form>
  </Sheet>;
}

function DeleteSim({ sim, onClose, onDeleted }: { sim: SimCard; onClose: () => void; onDeleted: (name: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true); setError(null);
    try { await api(`/sim-cards/${sim.id}`, { method: 'DELETE' }); onDeleted(sim.name); onClose(); }
    catch (e) { setError(offlineAware(e)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={t('Tirtir SIM Card?', 'Delete SIM card?')}>
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface-container-low">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${providerTone[sim.provider]}`}><Icon name="sim_card" className="text-[20px]" /></div>
      <div className="flex-1 min-w-0"><div className="text-[15px] font-semibold break-words">{sim.name}</div><div className="text-[13px] text-on-surface-variant">{formatMsisdn(sim.phone)} · {providerName(sim.provider)}</div></div>
    </div>
    <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t('Ma hubtaa inaad tirtirto diiwaankan? Kaliya diiwaanka Toosh ayaa la tirtirayaa. SIM-ka dhabta ah, lambarka iyo adeegga shirkadda ma xirmayaan, xogtaada kalena (fariimaha, lambarada EVC, qarashaadka) waa sidooda.', 'Delete this record? Only the record in Toosh is removed. The real SIM, the number and the network service are not deactivated, and your other data (messages, EVC numbers, expenses) stays as it is.')}</p>
    {error && <Banner tone="error" icon="error">{error}</Banner>}
    <div className="grid grid-cols-2 gap-2"><Button kind="tonal" onClick={onClose}>{t('Jooji', 'Cancel')}</Button>
      <Button id="confirmDeleteSimBtn" kind="danger" icon="delete" className="!bg-error !text-on-error" disabled={busy} onClick={remove}>{t('Tirtir', 'Delete')}</Button></div>
  </Sheet>;
}

/** This month's EVC Plus money in and out for a SIM, or why there is none yet. */
function SimMoney({ sim, onTrack }: { sim: SimCard; onTrack: () => void }) {
  const { me, setSelectedNumberId } = useSession();
  const { show } = useAmounts();
  const tr = sim.tracking;
  if (tr) {
    return <div className="mx-4 mb-2.5 rounded-2xl bg-surface-container-low px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="sim-money">
      <span className="w-full text-[12px] font-semibold text-on-surface-variant">{t(`Bishan · ${walletOf(sim.provider)}`, `This month · ${walletOf(sim.provider)}`)}</span>
      <span className="flex items-center gap-1 text-[14px] font-bold text-primary-container whitespace-nowrap"><Icon name="south_west" className="text-[16px]" />{show(cash(tr.inTotal, 'USD', '+'))}<span className="text-[12px] font-medium text-on-surface-variant">({tr.inCount})</span></span>
      <span className="flex items-center gap-1 text-[14px] font-bold text-on-surface whitespace-nowrap"><Icon name="north_east" className="text-[16px] text-error" />{show(cash(tr.outTotal, 'USD', '-'))}<span className="text-[12px] font-medium text-on-surface-variant">({tr.outCount})</span></span>
      <button type="button" onClick={() => { setSelectedNumberId(tr.evcNumberId); navigate('dhaqdhaqaaq'); }} className="ml-auto min-h-9 py-1 px-3 -mr-1 rounded-full text-[13px] font-bold text-primary-container flex items-center gap-0.5 active:bg-surface-container leading-tight">
        {t('Dhaqdhaqaaq', 'Activity')}<Icon name="chevron_right" className="text-[18px]" /></button>
      {!tr.sourceDeviceId && <span className="w-full text-[12px] text-tertiary-container">{t('Weli taleefan SMS-ka lambarkan akhriya lama xirin.', 'No phone reads this number’s SMS yet.')}</span>}
    </div>;
  }
  if (trackable(sim.provider)) {
    const here = isNativeAndroid && sim.simSubscriptionId !== null && sim.detectedDeviceId === me!.device.id;
    return <div className="mx-4 mb-2.5 rounded-2xl bg-surface-container-low px-3 py-2.5 flex flex-wrap items-center gap-2">
      <span className="flex-1 min-w-[150px] text-[12.5px] leading-[1.36] text-on-surface-variant">{here ? t(`La soco lacagaha soo gala iyo kuwa baxa ee SIM-kan (${walletOf(sim.provider)}).`, `Track money in and out on this SIM (${walletOf(sim.provider)}).`) : t('Si loola socdo lacagaha, ka fur Toosh taleefanka SIM-kan ku jiro.', 'To track money, open Toosh on the phone that holds this SIM.')}</span>
      {here && <button type="button" onClick={onTrack} className="min-h-9 py-1 px-3.5 rounded-full bg-primary-container text-on-primary text-[13px] font-bold pressable leading-tight">{t('La soco', 'Track')}</button>}
    </div>;
  }
  return <p className="mx-4 mb-2.5 text-[12px] leading-[1.36] text-on-surface-variant">{sim.provider === 'SOMTEL'
    ? t('Lacagaha eDahab (Somtel) weli lama akhrin karo — waxaan u baahanahay tusaalooyin SMS ah.', 'eDahab (Somtel) money is not read yet — sample SMS are needed.')
    : sim.provider === 'GOLIS' ? t('Lacagaha Golis weli lama akhrin karo.', 'Golis money is not read yet.') : t('Lacagaha kaliya EVC Plus (Hormuud) iyo Jeeb (Somnet) ayaa hadda la akhriyaa.', 'Only EVC Plus (Hormuud) and Jeeb (Somnet) money is read for now.')}</p>;
}

interface Found { sim: Sim; pick: boolean; name: string; phone: string; provider: SimProvider; track: boolean; already: SimCard | null }

/** Lists the SIMs in this phone; the person ticks which to add and whether to track their EVC Plus money. */
function DetectSims({ existing, onClose, onDone }: { existing: SimCard[]; onClose: () => void; onDone: (msg: string) => void }) {
  const { me, native, refreshNative, refreshMe, tz } = useSession();
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => {
    try {
      let state = (await TooshNative.getStatus()).phoneStatePermission;
      if (state !== 'GRANTED') state = (await TooshNative.requestPhoneStatePermission()).state;
      await refreshNative();
      if (state !== 'GRANTED') { setError(t('Toosh wuxuu u baahan yahay ogolaanshaha "Taleefanka" si uu u arko SIM-yada. Ka oggolow Settings-ka taleefanka.', 'Toosh needs the "Phone" permission to see the SIMs. Allow it in the phone settings.')); setFound([]); return; }
      const { sims } = await TooshNative.listSims();
      setFound(sims.map(sim => {
        const number = sim.number ? normalizeSomaliSimNumber(sim.number) : null;
        const phone = number?.ok ? number.e164 : null;
        const already = existing.find(e => (e.detectedDeviceId === me!.device.id && e.simSubscriptionId === sim.subscriptionId) || (phone && e.phone === phone)) ?? null;
        const provider = providerFromCarrier(sim.carrierName ?? sim.displayName);
        return { sim, already, pick: !already, provider, track: trackable(provider),
          name: (sim.displayName || sim.carrierName || `SIM ${sim.simSlot + 1}`).slice(0, 60), phone: phone ? formatMsisdn(phone).replace('+252 ', '') : '' };
      }));
    } catch { setError(t('SIM-yada lama akhrin karin.', 'The SIMs could not be read.')); setFound([]); }
  })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, p: Partial<Found>) => setFound(f => f!.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function save() {
    setError(null);
    const picked = found!.map((f, i) => ({ f, i })).filter(x => x.f.pick && !x.f.already);
    const errs: Record<number, string> = {};
    for (const { f, i } of picked) {
      if (!f.name.trim()) errs[i] = t('Geli magaca SIM-ka.', 'Enter a name for the SIM.');
      else if (!normalizeSomaliSimNumber(f.phone).ok) errs[i] = t('Geli lambarka SIM-kan (Android ma bixin).', 'Enter this SIM’s number (Android did not provide it).');
    }
    setErrors(errs);
    if (Object.keys(errs).length || !picked.length) { if (!picked.length) setError(t('Dooro ugu yaraan hal SIM.', 'Choose at least one SIM.')); return; }
    setBusy(true);
    const problems: string[] = []; let added = 0;
    try {
      for (const { f, i } of picked) {
        const phone = (normalizeSomaliSimNumber(f.phone) as { e164: string }).e164;
        try {
          await api('/sim-cards', { method: 'POST', body: { name: f.name.trim(), phone, provider: f.provider, registeredOn: localDate(new Date(), tz), notes: null, simSlot: f.sim.simSlot, simSubscriptionId: f.sim.subscriptionId } });
          added++;
        } catch (e) { errs[i] = offlineAware(e); continue; }
        if (f.track && trackable(f.provider)) {
          const problem = await trackOnThisPhone(phone, f.name.trim(), f.sim, me!.evcNumbers, native?.strictFilter ?? true).catch(e => offlineAware(e));
          if (problem) problems.push(problem);
          else await refreshMe();
        }
      }
      setErrors({ ...errs });
      await refreshMe(); await refreshNative();
      if (added && !Object.keys(errs).length) {
        onDone(t(`${added} SIM ayaa la daray.`, `${added} SIM(s) added.`) + (problems.length ? ` ${problems.join(' ')}` : ''));
        onClose();
      } else if (problems.length) setError(problems.join(' '));
    } finally { setBusy(false); }
  }

  return <Sheet open onClose={onClose} title={t('SIM-yada taleefanka', 'SIMs on this phone')}>
    <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(70dvh/var(--app-zoom,1))] -mx-1 px-1 pb-1">
      {!found && <Spinner label={t('SIM-yada waa la raadinayaa…', 'Looking for SIMs…')} />}
      {found && !found.length && !error && <p className="text-[14px] text-on-surface-variant">{t('SIM firfircoon lama helin.', 'No active SIM found.')}</p>}
      {found?.map((f, i) => <div key={f.sim.subscriptionId} data-testid="found-sim" className={`rounded-2xl p-3 flex flex-col gap-3 border-2 ${f.pick && !f.already ? 'border-primary-container bg-primary-fixed/30' : 'border-transparent bg-surface-container-low'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${providerTone[f.provider]}`}><Icon name="sim_card" className="text-[20px]" /></div>
          <div className="flex-1 min-w-0"><div className="text-[15px] font-bold break-words">SIM {f.sim.simSlot + 1}{f.sim.carrierName ? ` · ${f.sim.carrierName}` : ''}</div>
            <div className="text-[12.5px] text-on-surface-variant">{f.already ? t(`Horay ayaa loo daray: ${f.already.name}`, `Already added: ${f.already.name}`) : providerName(f.provider)}</div></div>
          {!f.already && <Toggle label={`${t('Ku dar', 'Add')} SIM ${f.sim.simSlot + 1}`} checked={f.pick} onChange={v => set(i, { pick: v })} />}
        </div>
        {f.pick && !f.already && <>
          <Field label={t('Magaca', 'Name')}><input value={f.name} maxLength={60} onChange={e => set(i, { name: e.target.value })} className={INPUT} /></Field>
          <Field label={t('Lambarka', 'Number')} hint={f.sim.number ? undefined : t('Android ma bixin lambarka SIM-kan — geli.', 'Android did not give this SIM’s number — type it.')}>
            <div className="flex items-center gap-2"><span className="text-[15px] font-bold text-on-surface-variant shrink-0">+252</span>
              <input type="tel" inputMode="tel" value={f.phone} onChange={e => set(i, { phone: e.target.value })} placeholder="61 XXX XXXX" className={`${INPUT} font-semibold`} /></div></Field>
          <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Shirkadda', 'Network')}</span>
            <Segmented label={t('Shirkadda', 'Network')} value={f.provider} onChange={v => set(i, { provider: v, track: trackable(v) })} options={[['HORMUUD', 'Hormuud'], ['SOMTEL', 'Somtel'], ['SOMNET', 'Somnet'], ['GOLIS', 'Golis'], ['OTHER', t('Kale', 'Other')]]} /></div>
          {trackable(f.provider) && <div className="flex items-center gap-3">
            <span className="flex-1 text-[13.5px] leading-[1.38]"><strong className="block text-on-surface">{t(`La soco lacagaha (${walletOf(f.provider)})`, `Track money (${walletOf(f.provider)})`)}</strong><span className="text-on-surface-variant">{t(`SMS-ka ${walletOf(f.provider)} ee SIM-kan ayaa la akhrinayaa: soo galay iyo baxay.`, `${walletOf(f.provider)} SMS on this SIM are read: money in and out.`)}</span></span>
            <Toggle label={t(`La soco lacagaha (${walletOf(f.provider)})`, `Track money (${walletOf(f.provider)})`)} checked={f.track} onChange={v => set(i, { track: v })} /></div>}
        </>}
        {errors[i] && <p role="alert" className="text-[13px] text-error">{errors[i]}</p>}
      </div>)}
      {error && <Banner tone="error" icon="error">{error}</Banner>}
    </div>
    {found && found.some(f => !f.already) && <Button id="saveFoundSimsBtn" disabled={busy} icon={busy ? 'progress_activity' : 'check'} spin={busy} onClick={save}>{t('Ku dar SIM-yada la doortay', 'Add the chosen SIMs')}</Button>}
  </Sheet>;
}

/** Starts tracking EVC Plus money for a SIM found on this phone earlier. */
function TrackSim({ sim, onClose, onDone }: { sim: SimCard; onClose: () => void; onDone: (msg: string) => void }) {
  const { me, native, refreshMe, refreshNative } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setError(null);
    try {
      const problem = await trackOnThisPhone(sim.phone, sim.name, { subscriptionId: sim.simSubscriptionId!, simSlot: sim.simSlot ?? 0, carrierName: providerName(sim.provider) }, me!.evcNumbers, native?.strictFilter ?? true);
      await refreshMe(); await refreshNative();
      if (problem) { setError(problem); return; }
      onDone(t(`Lacagaha ${sim.name} hadda waa la la socdaa.`, `${sim.name} money is now tracked.`)); onClose();
    } catch (e) { setError(offlineAware(e)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={t('La soco lacagaha', 'Track money')}>
    <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t(`Toosh wuxuu akhrin doonaa fariimaha ${walletOf(sim.provider)} ee SIM-ka "${sim.name}" (${formatMsisdn(sim.phone)}) ee taleefankan, si loo arko lacagaha soo gala iyo kuwa baxa. Fariimaha kale lama keydiyo.`, `Toosh will read ${walletOf(sim.provider)} messages on the SIM "${sim.name}" (${formatMsisdn(sim.phone)}) on this phone to show money in and out. Other messages are never stored.`)}</p>
    {error && <Banner tone="error" icon="error">{error}</Banner>}
    <Button id="confirmTrackBtn" disabled={busy} icon="check" onClick={go}>{t('La soco', 'Track')}</Button>
  </Sheet>;
}
