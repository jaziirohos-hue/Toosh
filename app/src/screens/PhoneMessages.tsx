import { useEffect, useMemo, useState } from 'react';
import { normalizeSomaliSimNumber, numbersIn, suggestName } from '@toosh/shared';
import { Field, INPUT, LABEL, Segmented, offlineAware } from '../components/finance.tsx';
import { Banner, Button, EmptyState, Floating, Group, Header, Icon, Main, Sheet, Spinner } from '../components/ui.tsx';
import { api, type ApiFailure } from '../lib/api.ts';
import { shortDateTime } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { isNativeAndroid, TooshNative, type PhoneMessage, type Sim } from '../lib/native.ts';
import { goBack } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { syncRulesToPhone, trackOnThisPhone } from '../lib/sources.ts';
import { invalidateAll, useResource } from '../lib/sync.ts';

interface TaughtRule { id: string; sender: string; direction: 'IN' | 'OUT' | 'NONE'; example: string; createdAt: string }
const directionText = (d: TaughtRule['direction']) => (d === 'IN' ? t('Soo galay', 'Money in') : d === 'OUT' ? t('Baxay', 'Money out') : t('Ma aha lacag', 'Not money'));

/**
 * "All phone messages": the phone's SMS from every sender, read on this phone only, with search and a sender
 * filter. Tapping one teaches Toosh its format (money in, money out or not money).
 */
export function PhoneMessages() {
  const { native, refreshNative } = useSession();
  const [messages, setMessages] = useState<PhoneMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [sender, setSender] = useState<string>('all');
  const [onlyNew, setOnlyNew] = useState(false);
  const [teaching, setTeaching] = useState<PhoneMessage | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rules = useResource<{ rules: TaughtRule[] }>('rules', () => api('/rules'));
  const granted = native?.readSmsPermission === 'GRANTED';
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 4500); return () => clearTimeout(h); }, [toast]);

  async function load(reset: boolean) {
    setLoading(true); setError(null);
    try {
      const before = reset ? undefined : messages?.[messages.length - 1]?.date;
      const r = await TooshNative.listPhoneMessages({ limit: 150, before });
      setMessages(m => (reset ? r.messages : [...(m ?? []), ...r.messages]));
      setMore(r.messages.length === 150);
    } catch { setError(t('Fariimaha taleefanka lama akhrin karin.', 'The phone messages could not be read.')); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (isNativeAndroid && granted) load(true); }, [granted]); // eslint-disable-line react-hooks/exhaustive-deps
  async function allow() {
    const r = await TooshNative.requestReadSmsPermission();
    await refreshNative();
    if (r.state !== 'GRANTED') setError(t('Ogolaanshaha akhrinta fariimaha lama bixin. Ka oggolow Settings-ka taleefanka.', 'Permission to read messages was not given. Allow it in the phone settings.'));
  }

  const senders = useMemo(() => {
    const count = new Map<string, number>();
    for (const m of messages ?? []) count.set(m.sender, (count.get(m.sender) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s]) => s);
  }, [messages]);
  const shown = (messages ?? []).filter(m => (sender === 'all' || m.sender === sender) && (!onlyNew || !m.kept)
    && (!q.trim() || `${m.sender} ${m.body}`.toLowerCase().includes(q.trim().toLowerCase())));

  if (!isNativeAndroid) return <><Header title={t('Fariimaha taleefanka', 'Phone messages')} back={() => goBack('fariimaha')} />
    <Main><Banner tone="info" icon="phone_android">{t('Fariimaha taleefanka waxaa laga arkaa app-ka Android ee taleefanka fariimuhu ku jiraan. Qaababka aad halkaas ku barato halkan ayay ka muuqdaan.', 'Phone messages are shown in the Android app on the phone that has them. Formats you teach there are listed here.')}</Banner>
      <TaughtList rules={rules.data?.rules ?? []} onChanged={rules.reload} /></Main></>;

  return <>
    <Header title={t('Fariimaha taleefanka', 'Phone messages')} back={() => goBack('fariimaha')} />
    <Main>
      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-secondary-fixed/70 text-on-secondary-fixed">
        <Icon name="school" className="text-secondary shrink-0 text-[20px]" />
        <p className="text-[13.5px] leading-[1.41]">{t('Taabo fariin si aad Toosh u barto: lacag soo gashay, lacag baxday ama ma aha lacag. Fariimaha qaabkaas ah ee dambe si toos ah ayaa loo kala saarayaa. Fariimahan taleefankan ayay ku jiraan oo keliya; lama diro ilaa aad barto.', 'Tap a message to teach Toosh: money in, money out or not money. Later messages in that format are sorted automatically. These messages stay on this phone; nothing is sent until you teach one.')}</p>
      </div>
      <button type="button" id="taughtRulesBtn" onClick={() => setRulesOpen(true)} className="card w-full text-left px-4 py-3 flex items-center gap-3 active:bg-surface-container-low">
        <Icon name="rule" className="text-primary-container text-[22px]" />
        <span className="flex-1 text-[15px] font-semibold">{t('Qaababka la baray', 'Taught formats')}</span>
        <span className="text-[14px] font-bold text-on-surface-variant">{rules.data?.rules.length ?? '—'}</span><Icon name="chevron_right" className="text-on-surface-variant" /></button>

      {!granted ? <>
        <EmptyState icon="sms" title={t('Oggolow akhrinta fariimaha', 'Allow reading messages')} text={t('Toosh wuxuu u baahan yahay ogolaanshaha "SMS" si uu kuu tuso fariimaha taleefanka.', 'Toosh needs the "SMS" permission to show the phone messages.')} />
        <Button icon="lock_open" onClick={allow}>{t('Oggolow', 'Allow')}</Button>
      </> : <>
        <div className="relative flex items-center w-full">
          <Icon name="search" className="absolute left-4 text-on-surface-variant text-[22px] pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} type="search" aria-label={t('Raadi fariimaha', 'Search messages')} placeholder={t('Raadi diraha ama qoraal', 'Search sender or text')}
            className="w-full min-h-12 py-2 pl-12 pr-4 rounded-full bg-surface-container-lowest border border-outline-variant/60 text-on-surface text-[15px] placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary-container leading-tight" />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('Diraha', 'Sender')}>
          {['all', ...senders].map(s => <button key={s} type="button" aria-pressed={sender === s} onClick={() => setSender(s)}
            className={`min-h-9 py-1 px-3.5 rounded-full text-[13.5px] font-semibold leading-tight pressable break-all ${sender === s ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface'}`}>{s === 'all' ? t('Dhammaan', 'All') : s}</button>)}
          <button type="button" aria-pressed={onlyNew} onClick={() => setOnlyNew(v => !v)}
            className={`min-h-9 py-1 px-3.5 rounded-full text-[13.5px] font-semibold leading-tight pressable flex items-center gap-1 ${onlyNew ? 'bg-tertiary-container text-on-tertiary' : 'bg-surface-container text-on-surface'}`}>
            <Icon name="filter_alt" className="text-[16px]" />{t('Kuwa aan la haynin', 'Not kept yet')}</button>
        </div>
        {error && <Banner tone="error" icon="error">{error}</Banner>}
        {!messages && <Spinner label={t('Fariimaha waa la akhrinayaa…', 'Reading messages…')} />}
        {messages && !shown.length && <EmptyState icon="search_off" title={t('Fariin lama helin', 'No messages found')} text={t('Beddel raadinta ama shaandhaynta.', 'Change the search or filter.')} />}
        {shown.length > 0 && <Group>{shown.map(m => <button key={m.id} type="button" data-testid="phone-message" onClick={() => setTeaching(m)} className="w-full text-left px-4 py-3 flex flex-col gap-1 active:bg-surface-container-low">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-bold text-on-surface break-all">{m.sender}</span>
            <span className="text-[12px] text-on-surface-variant whitespace-nowrap">{shortDateTime(new Date(m.date).toISOString(), 'Africa/Mogadishu')}</span>
            {m.kept && <span className="ml-auto inline-flex items-center gap-1 min-h-6 py-0.5 px-2 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[11.5px] font-bold leading-tight"><Icon name="check" className="text-[13px]" />{m.taughtRuleId ? t('La baray', 'Taught') : t('Toosh wuu hayaa', 'Kept')}</span>}
          </div>
          <p className="sms-text text-on-surface-variant line-clamp-3 break-words">{m.body}</p>
        </button>)}</Group>}
        {messages && more && <Button kind="tonal" disabled={loading} onClick={() => load(false)} className="self-center h-11 text-[14.5px]">{loading ? t('Waa la akhrinayaa…', 'Reading…') : t('Soo qaad kuwo hore', 'Load older')}</Button>}
      </>}
    </Main>
    {teaching && <TeachSheet message={teaching} onClose={() => setTeaching(null)} onDone={msg => { setToast(msg); rules.reload(); load(true); invalidateAll(); }} />}
    {rulesOpen && <Sheet open onClose={() => setRulesOpen(false)} title={t('Qaababka la baray', 'Taught formats')}>
      <div className="overflow-y-auto max-h-[calc(70dvh/var(--app-zoom,1))] -mx-1 px-1"><TaughtList rules={rules.data?.rules ?? []} onChanged={() => { rules.reload(); if (isNativeAndroid) syncRulesToPhone().catch(() => {}); }} /></div>
    </Sheet>}
    {toast && <Floating><div role="status" data-testid="teach-toast" className="fixed left-4 right-4 bottom-[calc(max(env(safe-area-inset-bottom,0px),8px)+84px)] z-[60] max-w-md mx-auto px-4 py-3 rounded-2xl bg-inverse-surface text-inverse-on-surface shadow-lg flex items-center gap-2.5 screen-in">
      <Icon name="school" className="text-[20px] text-primary-fixed-dim" /><span className="text-[14px] flex-1 break-words">{toast}</span></div></Floating>}
  </>;
}

/** The formats taught so far, each with a remove button. */
export function TaughtList({ rules, onChanged }: { rules: TaughtRule[]; onChanged: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function remove(id: string) {
    setError(null);
    try { await api(`/rules/${id}`, { method: 'DELETE' }); onChanged(); invalidateAll(); } catch (e) { setError(offlineAware(e)); } finally { setRemoving(null); }
  }
  if (!rules.length) return <p className="px-1 text-[14px] text-on-surface-variant">{t('Weli qaab lama barin. Taabo fariin si aad u barto.', 'Nothing taught yet. Tap a message to teach one.')}</p>;
  return <div className="flex flex-col gap-2">
    {error && <Banner tone="error" icon="error">{error}</Banner>}
    {rules.map(r => <div key={r.id} data-testid="taught-rule" className="rounded-2xl bg-surface-container-low p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[14.5px] font-bold break-all">{r.sender}</span>
        <span className={`min-h-6 py-0.5 px-2 rounded-full text-[11.5px] font-bold leading-tight ${r.direction === 'IN' ? 'bg-primary-fixed text-on-primary-fixed-variant' : r.direction === 'OUT' ? 'bg-error-container text-on-error-container' : 'bg-surface-container-high text-on-surface'}`}>{directionText(r.direction)}</span>
        {removing === r.id
          ? <span className="ml-auto flex gap-1"><button type="button" onClick={() => setRemoving(null)} className="min-h-9 px-3 rounded-full text-[13px] font-bold bg-surface-container">{t('Jooji', 'Cancel')}</button>
            <button type="button" onClick={() => remove(r.id)} className="min-h-9 px-3 rounded-full text-[13px] font-bold bg-error text-on-error">{t('Ka saar', 'Remove')}</button></span>
          : <button type="button" aria-label={`${t('Ka saar', 'Remove')} ${r.sender}`} onClick={() => setRemoving(r.id)} className="ml-auto w-10 h-10 rounded-full flex items-center justify-center text-error active:bg-error-container"><Icon name="delete" className="text-[21px]" /></button>}
      </div>
      <p className="sms-text text-on-surface-variant line-clamp-2 break-words">{r.example}</p>
    </div>)}
    <p className="px-1 text-[12.5px] text-on-surface-variant">{t('Ka saarista qaab ma beddeleyso fariimihii horay loo kala saaray.', 'Removing a format does not change messages it already sorted.')}</p>
  </div>;
}

/** Teach Toosh one message: what it is, which number is the amount (and balance), and the other person. */
function TeachSheet({ message, onClose, onDone }: { message: PhoneMessage; onClose: () => void; onDone: (msg: string) => void }) {
  const { me, native, refreshMe, refreshNative } = useSession();
  const nums = useMemo(() => numbersIn(message.body).filter(n => n.value !== null && n.text.replace(/\D/g, '').length <= 8), [message.body]);
  const firstDollar = nums.find(n => message.body.includes(`$${n.text}`)) ?? nums[0];
  const [direction, setDirection] = useState<'IN' | 'OUT' | 'NONE'>('IN');
  const [amount, setAmount] = useState<string | null>(firstDollar?.text ?? null);
  const [balance, setBalance] = useState<string | null>(null);
  const [name, setName] = useState(suggestName(message.body) ?? '');
  const [simPhone, setSimPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Is the SIM this message came to already linked to one of the account's money numbers on this phone?
  const linked = me!.evcNumbers.some(n => n.sourceDeviceId === me!.device.id && (message.subscriptionId === null || n.simSubscriptionId === message.subscriptionId));
  const money = direction !== 'NONE';

  async function save() {
    setError(null);
    const errs: Record<string, string> = {};
    if (money && !amount) errs.amount = t('Dooro qaddarka lacagta.', 'Choose the amount.');
    if (money && !linked && !normalizeSomaliSimNumber(simPhone).ok) errs.simPhone = t('Geli lambarka SIM-ka fariintan timid.', 'Enter the number of the SIM this message came to.');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await api<{ sorted: number }>('/rules', { method: 'POST', body: { sender: message.sender, body: message.body, direction, amount: money ? amount : null, balance: money ? balance : null, counterpartyName: money && name.trim() ? name.trim() : null } });
      await syncRulesToPhone();
      let found = 0;
      if (money) {
        if (!linked) {
          const sims: Sim[] = (await TooshNative.listSims().catch(() => ({ sims: [] as Sim[] }))).sims;
          const sim = sims.find(s => s.subscriptionId === message.subscriptionId) ?? sims[0];
          if (!sim) throw new Error(t('SIM-ka fariintan lama helin.', 'The SIM of this message was not found.'));
          const phone = (normalizeSomaliSimNumber(simPhone) as { e164: string }).e164;
          const problem = await trackOnThisPhone(phone, message.sender, sim, me!.evcNumbers, native?.strictFilter ?? true);
          if (problem) { setError(problem); return; }
          await refreshMe();
        }
        // Bring in this message and older ones of the same format already on the phone.
        found = (await TooshNative.startInitialImport({ days: 180 })).queued;
        await refreshNative();
      }
      onDone(money ? t(`Toosh waa la baray. ${found} fariimood oo cusub ayaa la helay${r.sorted ? `, ${r.sorted} sugayayna waa la kala saaray` : ''}.`, `Toosh learned it. ${found} new messages found${r.sorted ? `, ${r.sorted} waiting ones sorted` : ''}.`)
        : t('Toosh waa la baray: fariimahan lacag ma aha.', 'Toosh learned it: these messages are not money.'));
      onClose();
    } catch (e) {
      const f = e as ApiFailure;
      if (f.details) setErrors(f.details); else setError(f.status !== undefined ? offlineAware(e) : (e as Error).message);
    } finally { setBusy(false); }
  }

  const chip = (value: string | null, on: boolean, onClick: () => void, label: string) =>
    <button key={label} type="button" aria-pressed={on} onClick={onClick} className={`min-h-10 px-3.5 rounded-full text-[14px] font-bold leading-tight ${on ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface'}`}>{label}</button>;

  return <Sheet open onClose={onClose} title={t('Bar Toosh', 'Teach Toosh')}>
    <div className="flex flex-col gap-4 overflow-y-auto max-h-[calc(72dvh/var(--app-zoom,1))] -mx-1 px-1 pb-1">
      <div className="rounded-2xl bg-surface-container-low p-3"><div className="text-[13px] font-bold mb-1 break-all">{message.sender}</div>
        <p data-testid="teach-body" className="sms-text text-on-surface whitespace-pre-wrap break-words">{message.body}</p></div>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Fariintani waa', 'This message is')}</span>
        <Segmented label={t('Nooca', 'Type')} value={direction} onChange={setDirection} options={[['IN', t('Soo galay', 'Money in')], ['OUT', t('Baxay', 'Money out')], ['NONE', t('Ma aha lacag', 'Not money')]]} /></div>
      {money && <>
        <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Qaddarka lacagta', 'Amount')}</span>
          <div className="flex flex-wrap gap-2">{nums.map(n => chip(n.text, amount === n.text, () => setAmount(n.text), n.text))}</div>
          {!nums.length && <span className="px-1 text-[13px] text-error">{t('Fariintan lambar lacag ah kuma jiro.', 'This message has no amount.')}</span>}
          {errors.amount && <span role="alert" className="px-1 text-[13px] text-error">{errors.amount}</span>}</div>
        <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Haraaga (ikhtiyaari)', 'Balance (optional)')}</span>
          <div className="flex flex-wrap gap-2">{chip(null, balance === null, () => setBalance(null), t('Midna', 'None'))}{nums.filter(n => n.text !== amount).map(n => chip(n.text, balance === n.text, () => setBalance(n.text), n.text))}</div>
          {errors.balance && <span role="alert" className="px-1 text-[13px] text-error">{errors.balance}</span>}</div>
        <Field label={t('Magaca qofka kale (ikhtiyaari)', "Other person's name (optional)")} error={errors.counterpartyName} hint={t('Magacyada kale ee fariimaha dambe si toos ah ayaa loo akhriyaa.', 'Other names in later messages are read automatically.')}>
          <input value={name} onChange={e => setName(e.target.value)} className={INPUT} /></Field>
        {!linked && <Field label={t('Lambarka SIM-ka fariintan timid', 'Number of the SIM this message came to')} error={errors.simPhone} hint={t('Lacagaha SIM-kan waxaa loo xisaabinayaa lambarkan.', "This SIM's money is counted for this number.")}>
          <div className="flex items-center gap-2"><span className="text-[15px] font-bold text-on-surface-variant shrink-0">+252</span>
            <input id="teach-sim-phone" type="tel" inputMode="tel" value={simPhone} onChange={e => setSimPhone(e.target.value)} placeholder="6X XXX XXXX" className={`${INPUT} font-semibold`} /></div></Field>}
      </>}
      {errors.body && <Banner tone="error" icon="error">{errors.body}</Banner>}
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <Button id="saveTeachBtn" disabled={busy} icon={busy ? 'progress_activity' : 'school'} spin={busy} onClick={save}>{t('Bar Toosh', 'Teach Toosh')}</Button>
    </div>
  </Sheet>;
}
