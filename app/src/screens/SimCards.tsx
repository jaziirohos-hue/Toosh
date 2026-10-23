import { useEffect, useState } from 'react';
import { formatMsisdn, localDate, normalizeSomaliSimNumber } from '@toosh/shared';
import { Field, INPUT, LABEL, Segmented, offlineAware } from '../components/finance.tsx';
import { Banner, Button, EmptyState, Floating, Group, Header, Icon, Main, Sheet, Spinner } from '../components/ui.tsx';
import { api, qs, type ApiFailure } from '../lib/api.ts';
import { dayLabel } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { goBack } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll, useResource } from '../lib/sync.ts';
import type { SimCard, SimProvider } from '../lib/types.ts';

const providerName = (p: SimProvider) => (p === 'HORMUUD' ? 'Hormuud' : p === 'SOMTEL' ? 'Somtel' : p === 'GOLIS' ? 'Golis' : t('Kale', 'Other'));
const providerTone: Record<SimProvider, string> = {
  HORMUUD: 'bg-primary-fixed text-on-primary-fixed-variant', SOMTEL: 'bg-secondary-fixed text-on-secondary-fixed-variant',
  GOLIS: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', OTHER: 'bg-surface-container-high text-on-surface',
};

/** Dejinta → SIM Card: the person's own list of SIM cards. Records are notes; they never switch a real SIM on or off. */
export function SimCards() {
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<'all' | SimProvider>('all');
  const [editing, setEditing] = useState<SimCard | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SimCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
        {(['all', 'HORMUUD', 'SOMTEL', 'GOLIS', 'OTHER'] as const).map(p => <button key={p} type="button" aria-pressed={provider === p} onClick={() => setProvider(p)}
          className={`min-h-9 py-1 px-3.5 rounded-full text-[13.5px] font-semibold leading-tight pressable ${provider === p ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface'}`}>
          {p === 'all' ? t('Dhammaan', 'All') : providerName(p)}</button>)}
      </div>

      {list.error && !list.data && <Banner tone="error" icon="cloud_off">{offlineAware(list.error)}</Banner>}
      {!list.data && list.loading && <Spinner label={t('SIM Card-yada waa la soo qaadayaa…', 'Loading SIM cards…')} />}
      {list.data && <p className="px-1 -mb-2 text-[13px] font-semibold text-on-surface-variant" data-testid="sim-count">
        {filtered ? t(`${items.length} ka mid ah ${list.data.total} SIM Card`, `${items.length} of ${list.data.total} SIM cards`) : t(`${list.data.total} SIM Card`, `${list.data.total} SIM cards`)}</p>}
      {items.length > 0 && <Group>{items.map(s => <div key={s.id} className="flex items-center gap-1 pl-4 pr-1.5">
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
      </div>)}</Group>}
      {list.data && !items.length && <EmptyState icon="sim_card" title={filtered ? t('SIM Card lama helin', 'No SIM cards found') : t('Weli SIM Card ma jiro', 'No SIM cards yet')}
        text={filtered ? t('Beddel raadinta ama shirkadda.', 'Change the search or network.') : t('Ku dar SIM Card-yada aad isticmaasho si aad meel keliya uga aragto.', 'Add the SIM cards you use to see them in one place.')} />}
      <Button id="addSimBtn" icon="add" onClick={() => setEditing('new')}>{t('Ku dar SIM Card', 'Add SIM card')}</Button>
    </Main>

    {editing && <SimSheet sim={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
      onSaved={name => { list.reload(); invalidateAll(); setToast(editing === 'new' ? t(`${name} waa la daray.`, `${name} was added.`) : t(`${name} waa la kaydiyay.`, `${name} was saved.`)); }} />}
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
          options={[['HORMUUD', 'Hormuud'], ['SOMTEL', 'Somtel'], ['GOLIS', 'Golis'], ['OTHER', t('Kale', 'Other')]]} />
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
