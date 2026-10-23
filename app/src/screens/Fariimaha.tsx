import { useEffect, useMemo, useState } from 'react';
import { parseEvcSms, toDecimalString } from '@toosh/shared';
import { DateRangeSheet, periodLabel, periodQuery } from '../components/PeriodPicker.tsx';
import { Banner, Button, EmptyState, Header, Icon, Main, Sheet, Spinner, useAmounts } from '../components/ui.tsx';
import { t } from '../lib/i18n.ts';
import { api, qs } from '../lib/api.ts';
import { masked, money, shortDateTime } from '../lib/format.ts';
import { isNativeAndroid, TooshNative, type LocalMessage } from '../lib/native.ts';
import { onOutbox, type OutboxEntry } from '../lib/outbox.ts';
import { navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll, useResource } from '../lib/sync.ts';
import type { Message, MessagePage, PeriodChoice } from '../lib/types.ts';

type Filter = 'all' | 'in' | 'out' | 'pending' | 'ignored';

export function useOutbox() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => onOutbox(setEntries), []);
  return entries;
}

export function OutboxBadge({ entry }: { entry?: OutboxEntry }) {
  if (!entry) return null;
  const map = {
    queued: ['schedule', t('Sugaya isku-xir', 'Waiting to sync'), 'bg-surface-container-high text-on-surface-variant'],
    syncing: ['sync', t('Waa la dirayaa', 'Sending'), 'bg-secondary-fixed text-on-secondary-fixed'],
    failed: ['error', t('Lama kaydin', 'Not saved'), 'bg-error-container text-on-error-container'],
    conflict: ['warning', t('Isku dhac: fur', 'Conflict: open'), 'bg-tertiary-fixed text-on-tertiary-fixed'],
  };
  const [icon, label, cls] = map[entry.state];
  return <span className={`inline-flex items-center gap-1 min-h-6 py-0.5 px-2 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${cls} leading-tight`}><Icon name={icon} className={`text-[13px] ${entry.state === 'syncing' ? 'animate-spin' : ''}`} />{label}</span>;
}

/** Sync state of a message that is still on the phone (separate from its classification). */
function localState(m: LocalMessage): [string, string, string] {
  switch (m.state) {
    case 'UPLOADING': return ['sync', t('Waa la dirayaa', 'Sending'), 'bg-secondary-fixed text-on-secondary-fixed'];
    case 'FAILED': return ['error', t('Dirid way fashilantay', 'Sending failed'), 'bg-error-container text-on-error-container'];
    case 'UNMATCHED': return ['sim_card_alert', t('SIM lama garanayo', 'Unknown SIM'), 'bg-tertiary-fixed text-on-tertiary-fixed'];
    default: return ['schedule', t('Sugaya dirid (offline)', 'Waiting to send (offline)'), 'bg-surface-container-high text-on-surface-variant'];
  }
}

function LocalCard({ m, tz, onAssign }: { m: LocalMessage; tz: string; onAssign: (m: LocalMessage) => void }) {
  const p = useMemo(() => parseEvcSms(m.body, { receivedAt: new Date(m.receivedAt) }), [m.body, m.receivedAt]);
  const [icon, label, cls] = localState(m);
  return <article className="card p-4 flex flex-col gap-3 outline-1 outline-dashed outline-outline-variant -outline-offset-1">
    <div className="flex items-center justify-between gap-2">
      <span className={`inline-flex items-center gap-1 min-h-6 py-0.5 px-2 rounded-full text-[11.5px] font-semibold ${cls} leading-tight`}><Icon name={icon} className={`text-[13px] ${m.state === 'UPLOADING' ? 'animate-spin' : ''}`} />{label}</span>
      <span className="text-[12.5px] text-on-surface-variant">{shortDateTime(m.receivedAt, tz)}</span>
    </div>
    <p className="sms-text p-3 rounded-2xl bg-surface-container-low text-on-surface whitespace-pre-wrap break-words">{m.body}</p>
    {p.amountMilli !== null && <p className="text-[13px] text-on-surface-variant">{t('Qaddar la arkay:', 'Amount seen:')} <span className="font-bold text-on-surface">{money(toDecimalString(p.amountMilli))}</span> · {t('Kala saaridda waxay dhici doontaa marka la diro.', 'It is classified once sent.')}</p>}
    {m.lastError && <p className="text-[13px] text-error">{m.lastError}</p>}
    {m.state === 'UNMATCHED' && <Button kind="warn" icon="sim_card" onClick={() => onAssign(m)} className="h-11">{t('Dooro lambarka EVC', 'Choose EVC number')}</Button>}
  </article>;
}

const Sms = ({ body, clamp }: { body: string; clamp?: boolean }) =>
  <p className={`sms-text px-3.5 py-3 rounded-2xl bg-surface-container-low text-on-surface/90 whitespace-pre-wrap break-words ${clamp ? 'line-clamp-3' : ''}`}>{body}</p>;

function MessageCard({ m, tz, outbox }: { m: Message; tz: string; outbox?: OutboxEntry }) {
  const { show } = useAmounts();
  const open = () => navigate(`fariin/${m.id}`);
  const time = <span className="text-[12.5px] text-on-surface-variant whitespace-nowrap">{shortDateTime(m.receivedAt, tz)}</span>;
  if (m.classification === 'PENDING') {
    return <article className="card relative p-4 flex flex-col gap-3" data-testid="pending-card">
      <div className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full bg-tertiary-container" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="inline-flex items-center gap-1 min-h-6 py-0.5 px-2.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-[12px] font-bold leading-tight"><Icon name="hourglass_top" className="text-[14px]" />{t('Sugaya kala saarid', 'Needs review')}</span>
          <OutboxBadge entry={outbox} />
        </div>{time}
      </div>
      <Sms body={m.body} />
      {(m.parsed.amount || m.parsed.counterpartyPhone) && <div className="flex flex-wrap items-center gap-2">
        {m.parsed.amount && <span className="min-h-8 py-1 px-3 rounded-full bg-surface-container-low text-[13px] flex items-center gap-1 leading-tight"><span className="text-on-surface-variant">{t('Qaddar', 'Amount')}</span><span className="font-bold text-on-surface">{money(m.parsed.amount)}</span></span>}
        {m.parsed.counterpartyPhone && <span className="min-h-8 py-1 px-3 rounded-full bg-surface-container-low text-[13px] flex items-center gap-1 leading-tight"><Icon name="call" className="text-[14px] text-on-surface-variant" /><span className="font-semibold text-on-surface">{masked(m.parsed.counterpartyPhone)}</span></span>}
      </div>}
      <p className="flex items-center gap-1.5 text-[12.5px] text-on-surface-variant"><Icon name="info" className="text-[15px] text-tertiary-container" />{t('Laguma darin wadarta guud ilaa la kala saaro', 'Not in the totals until reviewed')}</p>
      <Button kind="warn" icon="rule" onClick={open} className="h-12">{t('Kala Saar Hadda', 'Review now')}</Button>
    </article>;
  }
  if (m.classification === 'NOT_TRANSACTION') {
    return <article className="card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0"><Icon name="block" className="text-[20px]" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] leading-snug font-semibold text-on-surface">{t('Ma aha transaction', 'Not a transaction')}{m.classificationSource === 'PARSER' ? t(' (haraag)', ' (balance)') : ''}</div>
          <div className="text-[12.5px] text-on-surface-variant">{t('Laguma darin wadarta lacagaha', 'Not in money totals')}</div>
        </div>
        <div className="flex flex-col items-end gap-1">{time}<OutboxBadge entry={outbox} /></div>
      </div>
      <Sms body={m.body} clamp />
      <div className="flex items-center justify-between">
        {m.balance ? <span className="text-[13px] text-on-surface-variant">Haraaga <span className="font-bold text-on-surface">{money(m.balance.amount)}</span></span> : <span />}
        <button onClick={open} className="min-h-9 py-1 px-3 -mr-2 rounded-full text-[14px] font-bold text-primary-container flex items-center gap-1 active:bg-surface-container-low leading-tight"><span>{t('Wax ka beddel', 'Edit')}</span><Icon name="edit" className="text-[16px]" /></button>
      </div>
    </article>;
  }
  const tx = m.transaction!; const out = tx.direction === 'OUT'; const auto = m.classificationSource === 'PARSER';
  const who = tx.counterpartyName ?? (tx.counterpartyPhone ? masked(tx.counterpartyPhone) : out ? t('Lacag baxday', 'Money sent') : t('Lacag soo gashay', 'Money received'));
  return <article className="card p-4 flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${out ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed text-on-primary-fixed-variant'}`}><Icon name={out ? 'north_east' : 'south_west'} className="text-[20px]" /></div>
      <div className="flex-1 min-w-[120px]">
        <div className="text-[15.5px] font-semibold text-on-surface line-clamp-2 break-words">{who}</div>
        <div className="text-[12.5px] leading-snug text-on-surface-variant">{out ? t('Baxay', 'Sent') : t('Soo galay', 'Received')} · {shortDateTime(m.receivedAt, tz)}</div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0 ml-auto">
        <span className={`text-[17px] leading-[1.29] font-extrabold tracking-tight ${out ? 'text-on-surface' : 'text-primary-container'}`}>{show(money(tx.amount, out ? '-' : '+'))}</span>
        {m.balance && <span className="text-[12px] text-on-surface-variant">{t('Haraaga', 'Balance')} {show(money(m.balance.amount))}</span>}
      </div>
    </div>
    <Sms body={m.body} clamp />
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0"><Icon name={auto ? 'verified' : 'edit_note'} fill={auto} className={`text-[16px] ${auto ? 'text-primary-container' : 'text-tertiary-container'}`} />
        <span className="text-[12.5px] leading-snug text-on-surface-variant">{auto ? t('Toos loo aqoonsaday', 'Recognised automatically') : t('Gacanta lagu kala saaray', 'Classified by hand')}</span><OutboxBadge entry={outbox} /></div>
      <button onClick={open} className="min-h-9 py-1 px-3 -mr-2 rounded-full text-[14px] font-bold text-primary-container flex items-center gap-0.5 shrink-0 active:bg-surface-container-low leading-tight"><span>{auto ? t('Faahfaahin', 'Details') : t('Wax ka beddel', 'Edit')}</span><Icon name={auto ? 'chevron_right' : 'edit'} className="text-[18px]" /></button>
    </div>
  </article>;
}

export function Fariimaha({ initialFilter }: { initialFilter?: string }) {
  const { me, tz, native, refreshNative } = useSession();
  const [filter, setFilter] = useState<Filter>((['all', 'in', 'out', 'pending', 'ignored'].includes(initialFilter ?? '') ? initialFilter : 'all') as Filter);
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodChoice>({ period: 'all' });
  const [dateOpen, setDateOpen] = useState(false);
  const [more, setMore] = useState<Message[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false);
  const [local, setLocal] = useState<LocalMessage[]>([]);
  const [assigning, setAssigning] = useState<LocalMessage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const outbox = useOutbox();
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const key = `messages:${filter}:${query}:${JSON.stringify(period)}`;
  const page = useResource<MessagePage>(key, () => api(`/messages${qs({ filter, q: query, ...periodQuery(period), limit: 30 })}`));
  useEffect(() => { setMore([]); setCursor(page.data?.nextCursor ?? null); }, [page.data]);
  const isSource = me!.evcNumbers.some(n => n.sourceDeviceId === me!.device.id);
  useEffect(() => {
    if (!isNativeAndroid || !isSource) return;
    TooshNative.getLocalMessages({ limit: 50, unsyncedOnly: true }).then(r => setLocal(r.messages)).catch(() => {});
  }, [isSource, native]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try { const r = await api<MessagePage>(`/messages${qs({ filter, q: query, ...periodQuery(period), limit: 30, cursor })}`); setMore(prev => [...prev, ...r.items]); setCursor(r.nextCursor); }
    finally { setLoadingMore(false); }
  }
  async function refresh() {
    setRefreshing(true);
    try { if (isNativeAndroid && isSource) await TooshNative.syncNow(); await refreshNative(); invalidateAll(); }
    finally { setTimeout(() => setRefreshing(false), 800); }
  }
  async function assign(evcNumberId: string) {
    if (!assigning) return;
    await TooshNative.assignUnmatched({ localIds: [assigning.localId], evcNumberId });
    setAssigning(null); await refreshNative();
  }

  const counts = page.data?.counts;
  const items = [...(page.data?.items ?? []), ...more];
  const chip = (f: Filter, label: string, count: number | undefined, dot?: string) => {
    const active = filter === f;
    const warn = f === 'pending' && (count ?? 0) > 0;
    return <button key={f} type="button" aria-pressed={active} onClick={() => setFilter(f)}
      className={`shrink-0 min-h-9 py-1 pl-3 pr-2 rounded-full text-[13.5px] font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors pressable ${active ? 'bg-inverse-surface text-inverse-on-surface' : 'bg-surface-container-lowest text-on-surface border border-outline-variant/60'} leading-tight`}>
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}<span>{label}</span>
      <span className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[12px] font-bold flex items-center justify-center ${warn ? 'bg-tertiary-container text-on-tertiary' : active ? 'bg-white/15' : 'bg-surface-container'}`}>{count ?? '·'}</span>
    </button>;
  };
  const listening = isSource ? native?.smsPermission === 'GRANTED' : me!.devices.some(d => d.role === 'SOURCE' && d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 2 * 3600e3);

  return <>
    <Header subtitle={t('Fariimaha', 'Messages')} msisdn={me!.evcNumbers[0]?.msisdn} />
    <Main>
      <div className="flex flex-col gap-3">
        <div className="relative flex items-center w-full">
          <Icon name="search" className="absolute left-4 text-on-surface-variant text-[22px] pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} aria-label={t('Ka raadi fariimaha', 'Search messages')} className="w-full min-h-12 py-2 pl-12 pr-11 rounded-full bg-surface-container-lowest border border-outline-variant/60 text-on-surface text-[15px] placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary-container leading-tight" placeholder="Raadi" type="search" />
          {q && <button aria-label={t('Nadiifi baaritaanka', 'Clear search')} onClick={() => setQ('')} className="absolute right-2 w-9 h-9 flex items-center justify-center text-on-surface-variant rounded-full active:bg-surface-container"><Icon name="close" className="text-[20px]" /></button>}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 pb-0.5 no-scrollbar">
          {chip('all', t('Dhammaan', 'All'), counts?.all)}
          {chip('pending', t('Sugaya', 'To review'), counts?.pending)}
          {chip('in', t('Soo galay', 'Received'), counts?.in, 'bg-primary-container')}
          {chip('out', t('Baxay', 'Sent'), counts?.out, 'bg-error')}
          {chip('ignored', t('Ma aha', 'Ignored'), counts?.ignored, 'bg-outline')}
          <button type="button" onClick={() => setDateOpen(true)} aria-label={t('Taariikh', 'Date')} className={`shrink-0 min-h-9 py-1 px-3 rounded-full flex items-center gap-1.5 text-[13.5px] font-semibold border pressable ${period.period !== 'all' ? 'bg-primary-fixed text-on-primary-fixed-variant border-transparent' : 'bg-surface-container-lowest text-on-surface border-outline-variant/60'} leading-tight`}>
            <Icon name="calendar_month" className="text-[18px]" />{period.period !== 'all' && <span>{periodLabel(period)}</span>}</button>
          {period.period !== 'all' && <button type="button" aria-label={t('Ka saar taariikhda', 'Clear date')} onClick={() => setPeriod({ period: 'all' })} className="shrink-0 w-9 h-9 rounded-full bg-surface-container flex items-center justify-center"><Icon name="close" className="text-[18px]" /></button>}
        </div>
      </div>

      <div className={`flex items-center gap-3 px-4 py-3 rounded-[20px] ${listening ? 'bg-primary-fixed/70' : 'bg-surface-container'}`}>
        <span className="relative flex w-2.5 h-2.5 shrink-0">{listening && <span className="absolute inset-0 rounded-full bg-primary-container/50 animate-ping" />}<span className={`relative w-2.5 h-2.5 rounded-full ${listening ? 'bg-primary-container' : 'bg-outline'}`} /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-bold text-on-surface">{listening ? t('Toos u shaqeynaya', 'Listening live') : t('Dhegeysiga SMS ma shaqeynayo', 'SMS listening is off')}</div>
          <div className="text-[12.5px] leading-[1.36] text-on-surface-variant">{listening ? t('Fariimaha EVC Plus ee cusub si toos ah ayay u soo galayaan.', 'New EVC Plus messages arrive automatically.') : t('Fur Toosh taleefanka asalka ah oo hubi ogolaanshaha SMS-ka.', 'Open Toosh on the source phone and check SMS permission.')}</div>
        </div>
        <button onClick={refresh} aria-label={t('Dib u eeg fariimaha cusub', 'Check for new messages')} className="w-10 h-10 rounded-full flex items-center justify-center text-primary-container active:bg-white/60 shrink-0"><Icon name="refresh" className={`text-[22px] ${refreshing ? 'animate-spin' : ''}`} /></button>
      </div>

      {local.length > 0 && <div className="flex flex-col gap-3" aria-label={t('Fariimaha taleefanka ku jira', 'Messages still on this phone')}>
        <Banner tone="info" icon="cloud_upload">{local.length} fariimood ayaa taleefankan ku kaydsan oo weli aan la dirin. Si toos ah ayaa loo diri doonaa marka khadku jiro.</Banner>
        {local.map(m => <LocalCard key={m.localId} m={m} tz={tz} onAssign={setAssigning} />)}
      </div>}

      {page.error && !page.data && <Banner tone="error" icon="cloud_off">{page.error.message}</Banner>}
      {page.stale && page.data && <Banner tone="info" icon="cloud_off">{t("Xogta la kaydiyay ayaa la muujinayaa; khadka ayaa go'an.", 'Showing saved data; you are offline.')}</Banner>}
      {!page.data && page.loading && <Spinner label={t('Fariimaha waa la soo qaadayaa…', 'Loading messages…')} />}
      {page.data && !items.length && <EmptyState icon="search_off" title={t('Fariin lama helin', 'No messages found')} text={query || period.period !== 'all' ? t('Isku day eray kale ama taariikh kale.', 'Try another word or date.') : t('Fariimaha EVC Plus way soo muuqan doonaan marka taleefanka asalka ahi helo.', 'EVC Plus messages appear when the source phone receives them.')} />}
      <div className="flex flex-col gap-3">{items.map(m => <MessageCard key={m.id} m={m} tz={tz} outbox={outbox.find(e => e.messageId === m.id)} />)}</div>
      {cursor && <Button kind="tonal" disabled={loadingMore} onClick={loadMore} className="self-center h-11 text-[14.5px]">{loadingMore ? t('Waa la soo qaadayaa…', 'Loading…') : t('Soo qaad kuwo hore', 'Load older')}</Button>}

      <p className="text-[12px] leading-[1.42] text-on-surface-variant/90 text-center px-4 pb-2">{t('Toosh wuxuu aqoonsadaa', 'Toosh recognises')} <strong className="text-on-surface font-semibold">"ayaad uwareejisay"</strong> ({t('Baxay', 'sent')}) {t('iyo', 'and')} <strong className="text-on-surface font-semibold">"waxaad ka heshay"</strong> ({t('Soo galay', 'received')}). {t('Kuwa kale waxay sugaan kala saarid.', 'Others wait for review.')}</p>
    </Main>
    {dateOpen && <DateRangeSheet open={dateOpen} onClose={() => setDateOpen(false)} value={period} onPick={setPeriod} tz={tz} />}
    <Sheet open={Boolean(assigning)} onClose={() => setAssigning(null)} title={t('Fariintan lambarkee bay u socotaa?', 'Which number is this message for?')}>
      <p className="text-[14px] leading-[1.43] text-on-surface-variant">{t('Android ma sheegin SIM-ka fariintan timid. Dooro lambarka EVC ee saxda ah si aan fariimaha lambarada kala duwan isugu dhex jirin.', 'Android did not say which SIM received this message. Choose the right EVC number so numbers do not get mixed.')}</p>
      {me!.evcNumbers.filter(n => n.sourceDeviceId === me!.device.id).map(n => <button key={n.id} onClick={() => assign(n.id)} className="flex items-center justify-between min-h-14 py-2 px-4 rounded-2xl bg-surface-container-low pressable leading-tight">
        <span className="text-[16px] font-bold">{masked(n.msisdn)}</span><span className="text-[14px] text-on-surface-variant">{n.simLabel ?? n.displayName}</span></button>)}
    </Sheet>
  </>;
}
