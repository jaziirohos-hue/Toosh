import { useEffect, useMemo, useState } from 'react';
import { parseEvcSms, toDecimalString } from '@toosh/shared';
import { DateRangeSheet, periodLabel, periodQuery } from '../components/PeriodPicker.tsx';
import { Banner, EmptyState, Header, Icon, Main, Sheet, Spinner } from '../components/ui.tsx';
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
    queued: ['schedule', 'Sugaya isku-xir', 'bg-surface-container-high text-on-surface-variant'],
    syncing: ['sync', 'Waa la dirayaa', 'bg-secondary-fixed text-on-secondary-fixed'],
    failed: ['error', 'Lama kaydin', 'bg-error-container text-on-error-container'],
    conflict: ['warning', 'Isku dhac: fur', 'bg-tertiary-fixed text-on-tertiary-fixed'],
  } as const;
  const [icon, label, cls] = map[entry.state];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-ui text-label-ui ${cls}`}><Icon name={icon} className={`text-[12px] ${entry.state === 'syncing' ? 'animate-spin' : ''}`} />{label}</span>;
}

/** Sync state of a message that is still on the phone (separate from its classification). */
function localState(m: LocalMessage): [string, string, string] {
  switch (m.state) {
    case 'UPLOADING': return ['sync', 'Waa la dirayaa', 'bg-secondary-fixed text-on-secondary-fixed'];
    case 'FAILED': return ['error', 'Dirid way fashilantay', 'bg-error-container text-on-error-container'];
    case 'UNMATCHED': return ['sim_card_alert', 'SIM lama garanayo', 'bg-tertiary-fixed text-on-tertiary-fixed'];
    default: return ['schedule', 'Sugaya dirid (offline)', 'bg-surface-container-high text-on-surface-variant'];
  }
}

function LocalCard({ m, tz, onAssign }: { m: LocalMessage; tz: string; onAssign: (m: LocalMessage) => void }) {
  const p = useMemo(() => parseEvcSms(m.body, { receivedAt: new Date(m.receivedAt) }), [m.body, m.receivedAt]);
  const [icon, label, cls] = localState(m);
  return <div className="relative rounded-2xl bg-surface-container-lowest p-4 shadow-sm flex flex-col gap-3 border border-dashed border-outline-variant">
    <div className="flex items-center justify-between gap-2">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-ui text-label-ui ${cls}`}><Icon name={icon} className={`text-[13px] ${m.state === 'UPLOADING' ? 'animate-spin' : ''}`} />{label}</span>
      <span className="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">{shortDateTime(m.receivedAt, tz)}</span>
    </div>
    <div className="p-3 rounded-xl bg-surface-container-low"><p className="font-label-numeric-sm text-label-numeric-sm text-on-surface leading-snug whitespace-pre-wrap break-words">{m.body}</p></div>
    {p.amountMilli !== null && <p className="font-body-sm text-body-sm text-on-surface-variant">Qaddar la arkay: <span className="font-label-numeric-sm font-bold text-on-surface">{money(toDecimalString(p.amountMilli))}</span> · Kala saaridda waxay dhici doontaa marka la diro.</p>}
    {m.lastError && <p className="font-body-sm text-body-sm text-error">{m.lastError}</p>}
    {m.state === 'UNMATCHED' && <button onClick={() => onAssign(m)} className="h-10 px-4 rounded-xl bg-tertiary-container text-on-tertiary font-title-md text-title-md flex items-center justify-center gap-1.5">
      <Icon name="sim_card" className="text-[18px]" />Dooro lambarka EVC</button>}
  </div>;
}

function MessageCard({ m, tz, outbox }: { m: Message; tz: string; outbox?: OutboxEntry }) {
  const open = () => navigate(`fariin/${m.id}`);
  const time = <span className="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">{shortDateTime(m.receivedAt, tz)}</span>;
  const raw = (strong = false) => <div className="p-3 rounded-xl bg-surface-container-low">
    {strong && <div className="flex items-center gap-1.5 text-on-surface-variant mb-1"><Icon name="sms" className="text-[15px]" /><span className="font-label-ui text-[10px] uppercase font-semibold text-outline">Qoraalka SMS-ka Asalka ah</span></div>}
    <p className={`font-label-numeric-sm text-label-numeric-sm leading-snug whitespace-pre-wrap break-words ${strong ? 'text-on-surface' : 'text-on-surface-variant leading-relaxed'}`}>{m.body}</p></div>;
  if (m.classification === 'PENDING') {
    return <div className="relative rounded-2xl bg-surface-container-lowest p-4 shadow-sm flex flex-col gap-3" data-testid="pending-card">
      <div className="absolute left-0 top-3 bottom-3 w-1.5 rounded-r-full bg-tertiary-container" />
      <div className="flex items-center justify-between pl-1 gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-ui text-label-ui flex items-center gap-1"><Icon name="pending" className="text-[13px] text-tertiary-container" />Sugaya kala saarid</span>
          <OutboxBadge entry={outbox} />
        </div>{time}
      </div>
      <div className="pl-1">{raw(true)}</div>
      {(m.parsed.amount || m.parsed.counterpartyPhone) && <div className="flex flex-wrap items-center gap-1.5 pl-1">
        {m.parsed.amount && <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container font-label-numeric-sm text-label-numeric-sm"><span className="text-on-surface-variant text-[11px] font-body-sm">Qaddar:</span><span className="font-bold text-on-surface">{money(m.parsed.amount)}</span></div>}
        {m.parsed.counterpartyPhone && <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container font-label-numeric-sm text-label-numeric-sm"><span className="text-on-surface-variant text-[11px] font-body-sm">Lambar:</span><span>{masked(m.parsed.counterpartyPhone)}</span></div>}
      </div>}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1 pl-1">
        <div className="flex items-center gap-1.5 text-on-surface-variant"><Icon name="info" className="text-[16px] text-tertiary-container shrink-0" /><span className="font-body-sm text-body-sm line-clamp-1">Laguma darin wadarta guud ilaa la kala saaro</span></div>
        <button onClick={open} className="h-10 px-4 rounded-xl bg-tertiary-container hover:bg-tertiary text-on-tertiary font-title-md text-title-md flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all"><Icon name="rule_settings" className="text-[18px]" /><span>Kala Saar Hadda</span></button>
      </div>
    </div>;
  }
  if (m.classification === 'NOT_TRANSACTION') {
    return <div className="relative rounded-2xl bg-surface-container-lowest p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-surface-container-highest text-on-surface-variant flex items-center justify-center"><Icon name="block" className="text-[18px]" /></div>
          <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-ui text-label-ui">Ma aha transaction{m.classificationSource === 'PARSER' ? ' (haraag)' : ''}</span><OutboxBadge entry={outbox} /></div>{time}
      </div>
      {raw()}
      {m.balance && <span className="px-2.5 py-1 rounded-lg bg-surface-container font-label-numeric-sm text-label-numeric-sm text-on-surface-variant w-fit">Haraaga: {money(m.balance.amount)}</span>}
      <div className="flex items-center justify-between pt-1"><span className="font-body-sm text-body-sm text-on-surface-variant">Laguma darin wadarta lacagaha</span>
        <button onClick={open} className="font-title-md text-title-md text-secondary hover:underline flex items-center gap-0.5"><span>Wax ka beddel</span><Icon name="edit" className="text-[16px]" /></button></div>
    </div>;
  }
  const t = m.transaction!; const out = t.direction === 'OUT'; const auto = m.classificationSource === 'PARSER';
  return <div className="relative rounded-2xl bg-surface-container-lowest p-4 shadow-sm flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${out ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed text-on-primary-fixed-variant'}`}><Icon name={out ? 'north_east' : 'south_west'} className="text-[18px]" /></div>
        <span className={`px-2 py-0.5 rounded-full font-label-ui text-label-ui w-fit ${out ? 'bg-error-container/60 text-on-error-container' : 'bg-primary-fixed text-on-primary-fixed-variant'}`}>{out ? 'Baxay' : 'Soo galay'} ({auto ? 'Toos u aqoonsaday' : 'Gacanta'})</span>
        <OutboxBadge entry={outbox} />
      </div>{time}
    </div>
    {raw()}
    <div className="flex flex-wrap items-center gap-2">
      <span className={`px-2.5 py-1 rounded-lg bg-surface-container font-label-numeric-md text-label-numeric-md font-bold ${out ? 'text-error' : 'text-primary-container'}`}>{money(t.amount, out ? '-' : '+')}</span>
      {(t.counterpartyName || t.counterpartyPhone) && <span className="px-2.5 py-1 rounded-lg bg-surface-container font-title-md text-title-md text-on-surface flex items-center gap-1 min-w-0"><Icon name="person" className="text-[14px] text-outline" /><span className="truncate">{t.counterpartyName ?? masked(t.counterpartyPhone)}</span></span>}
      {m.balance && <span className="px-2.5 py-1 rounded-lg bg-surface-container font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">Haraaga: {money(m.balance.amount)}</span>}
    </div>
    <div className="flex items-center justify-between pt-1">
      <div className="flex items-center gap-1 text-primary-container"><Icon name={auto ? 'verified' : 'edit_note'} className="text-[16px]" /><span className="font-body-sm text-body-sm text-on-surface-variant">{auto ? 'Si toos ah ayaa loo aqoonsaday' : 'Gacanta ayaa lagu kala saaray'}</span></div>
      <button onClick={open} className="font-title-md text-title-md text-secondary hover:underline flex items-center gap-0.5"><span>{auto ? 'Faahfaahin' : 'Wax ka beddel'}</span><Icon name={auto ? 'chevron_right' : 'edit'} className="text-[16px]" /></button>
    </div>
  </div>;
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
  const pending = counts?.pending ?? 0;
  const chip = (f: Filter, label: string, count: number | undefined, dot?: string, badge = 'bg-surface-container-high text-on-surface') => {
    const active = filter === f;
    return <button key={f} type="button" aria-pressed={active} onClick={() => setFilter(f)}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-label-ui text-label-ui whitespace-nowrap active:scale-95 transition-transform ${active ? (f === 'pending' ? 'bg-tertiary-fixed text-on-tertiary-fixed shadow-sm' : 'bg-primary-container text-on-primary shadow-sm') : 'bg-surface-container-low text-on-surface-variant'}`}>
      {f === 'pending' ? <Icon name="hourglass_top" className="text-[16px] text-tertiary-container" /> : dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      <span className={active ? 'font-semibold' : ''}>{label}</span>
      <span className={`font-label-numeric-sm text-label-numeric-sm px-1.5 py-0.5 rounded-full ${f === 'pending' ? 'bg-tertiary-container text-on-tertiary font-bold' : badge}`}>{count ?? '·'}</span>
    </button>;
  };
  const listening = isSource ? native?.smsPermission === 'GRANTED' : me!.devices.some(d => d.role === 'SOURCE' && d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 2 * 3600e3);

  return <>
    <Header subtitle="Fariimaha" msisdn={me!.evcNumbers[0]?.msisdn} />
    <Main>
      <div className="flex flex-col gap-3">
        <div className="relative flex items-center w-full">
          <Icon name="search" className="absolute left-3.5 text-outline text-[20px] pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} aria-label="Ka raadi fariimaha" className="w-full h-12 pl-10 pr-10 rounded-xl bg-surface-container-lowest text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none shadow-sm" placeholder="Ka raadi fariimaha EVC, lambar, ama magac..." type="search" />
          {q && <button aria-label="Nadiifi baaritaanka" onClick={() => setQ('')} className="absolute right-3 w-6 h-6 flex items-center justify-center text-outline hover:text-on-surface rounded-full"><Icon name="close" className="text-[18px]" /></button>}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
          {chip('all', 'Dhammaan', counts?.all)}
          {chip('in', 'Soo galay', counts?.in, 'bg-primary-container', 'bg-primary-fixed text-on-primary-fixed-variant')}
          {chip('out', 'Baxay', counts?.out, 'bg-error', 'bg-error-container text-on-error-container')}
          {chip('pending', 'Sugaya', counts?.pending)}
          {chip('ignored', 'Ma aha', counts?.ignored, 'bg-outline')}
          <button type="button" onClick={() => setDateOpen(true)} className={`shrink-0 h-9 px-2.5 rounded-xl flex items-center gap-1 ${period.period !== 'all' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface'}`}>
            <Icon name="calendar_today" className="text-[16px]" /><span className="font-label-ui text-label-ui">{period.period === 'all' ? 'Taariikh' : periodLabel(period)}</span></button>
          {period.period !== 'all' && <button type="button" aria-label="Ka saar taariikhda" onClick={() => setPeriod({ period: 'all' })} className="shrink-0 w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center"><Icon name="close" className="text-[16px]" /></button>}
        </div>
      </div>

      <div className="relative overflow-hidden bg-surface-container-low rounded-2xl p-3.5 shadow-sm flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-secondary-fixed flex items-center justify-center shrink-0 mt-0.5"><Icon name="sync_saved_locally" fill className="text-secondary text-[20px]" /></div>
        <div className="flex flex-col min-w-0 pr-1">
          <div className="flex items-center gap-1.5"><span className="font-title-md text-title-md text-on-surface leading-snug">Toosh SMS Engine</span><span className="px-1.5 rounded-full bg-surface-container-highest text-on-secondary-fixed font-label-ui text-[10px]">Toos</span></div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 leading-relaxed">Fariimaha waxaa laga soo waariday taleefankaaga Android. Toosh wuxuu aqoonsadaa <strong className="text-on-surface font-semibold">"ayaad uwareejisay"</strong> (Baxay) iyo <strong className="text-on-surface font-semibold">"waxaad ka heshay"</strong> (Soo galay).</p>
        </div>
      </div>

      {pending > 0 && <button type="button" onClick={() => setFilter('pending')} className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-tertiary-container/10 text-left">
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-tertiary-container animate-ping" /><span className="font-title-md text-title-md text-tertiary font-semibold">{pending} Fariimood oo u baahan xaqiijin</span></div>
        <span className="font-label-numeric-sm text-label-numeric-sm text-tertiary">Kala saar</span></button>}

      {local.length > 0 && <div className="flex flex-col gap-3" aria-label="Fariimaha taleefanka ku jira">
        <Banner tone="info" icon="cloud_upload">{local.length} fariimood ayaa taleefankan ku kaydsan oo weli aan la dirin. Si toos ah ayaa loo diri doonaa marka khadku jiro.</Banner>
        {local.map(m => <LocalCard key={m.localId} m={m} tz={tz} onAssign={setAssigning} />)}
      </div>}

      {page.error && !page.data && <Banner tone="error" icon="cloud_off">{page.error.message}</Banner>}
      {page.stale && page.data && <Banner tone="info" icon="cloud_off">Xogta la kaydiyay ayaa la muujinayaa; khadka ayaa go'an.</Banner>}
      {!page.data && page.loading && <Spinner label="Fariimaha waa la soo qaadayaa…" />}
      {page.data && !items.length && <EmptyState icon="search_off" title="Fariin lama helin" text={query || period.period !== 'all' ? 'Isku day eray kale ama taariikh kale.' : 'Fariimaha EVC Plus way soo muuqan doonaan marka taleefanka asalka ahi helo.'} />}
      <div className="flex flex-col space-y-3">{items.map(m => <MessageCard key={m.id} m={m} tz={tz} outbox={outbox.find(e => e.messageId === m.id)} />)}</div>
      {cursor && <button disabled={loadingMore} onClick={loadMore} className="self-center px-4 py-2.5 rounded-full bg-surface-container text-on-surface-variant font-title-md text-title-md disabled:opacity-50">{loadingMore ? 'Waa la soo qaadayaa…' : 'Soo qaad kuwo hore'}</button>}

      <div className="p-4 rounded-2xl bg-surface-container-low flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${listening ? 'bg-primary-fixed' : 'bg-surface-container-high'}`}><Icon name={listening ? 'mark_email_read' : 'mark_email_unread'} className="text-on-primary-fixed-variant text-[22px]" /></div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5"><span className="font-title-md text-title-md text-on-surface">{listening ? 'Toos u shaqeynaya' : 'Dhegeysiga SMS ma shaqeynayo'}</span><span className={`w-2 h-2 rounded-full ${listening ? 'bg-primary-container animate-pulse' : 'bg-outline'}`} /></div>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 leading-snug">{listening ? 'Fariimaha dhowaan soo dhaca si toos ah ayaa loo soo gelinayaa. Looma baahna inaad gacanta ku qorto.' : 'Fur Toosh taleefanka asalka ah oo hubi ogolaanshaha SMS-ka.'}</p>
        </div>
      </div>
      <div className="flex items-center justify-center py-2">
        <button onClick={refresh} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-surface-container text-on-surface-variant hover:text-on-surface font-title-md text-title-md transition-colors active:scale-95">
          <Icon name="refresh" className={`text-[18px] ${refreshing ? 'animate-spin' : ''}`} /><span>Dib u eeg fariimaha cusub</span></button>
      </div>
    </Main>
    {dateOpen && <DateRangeSheet open={dateOpen} onClose={() => setDateOpen(false)} value={period} onPick={setPeriod} tz={tz} />}
    <Sheet open={Boolean(assigning)} onClose={() => setAssigning(null)} title="Fariintan lambarkee bay u socotaa?">
      <p className="font-body-sm text-body-sm text-on-surface-variant">Android ma sheegin SIM-ka fariintan timid. Dooro lambarka EVC ee saxda ah si aan fariimaha lambarada kala duwan isugu dhex jirin.</p>
      {me!.evcNumbers.filter(n => n.sourceDeviceId === me!.device.id).map(n => <button key={n.id} onClick={() => assign(n.id)} className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low">
        <span className="font-label-numeric-md text-label-numeric-md">{masked(n.msisdn)}</span><span className="font-body-sm text-body-sm">{n.simLabel ?? n.displayName}</span></button>)}
    </Sheet>
  </>;
}
