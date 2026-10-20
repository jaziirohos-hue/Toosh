import { useEffect, useState } from 'react';
import { DateRangeSheet, periodLabel, periodQuery } from '../components/PeriodPicker.tsx';
import { Banner, EmptyState, Header, Icon, Main, Sheet, Spinner, TxRow } from '../components/ui.tsx';
import { api, qs } from '../lib/api.ts';
import { dayLabel, money } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { useResource } from '../lib/sync.ts';
import type { Message, PeriodChoice, TransactionPage } from '../lib/types.ts';

export function Dhaqdhaqaaq() {
  const { me, tz, selectedNumberId } = useSession();
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodChoice>({ period: 'month' });
  const [periodMenu, setPeriodMenu] = useState(false); const [customOpen, setCustomOpen] = useState(false);
  const [more, setMore] = useState<Message[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const params = { filter, q: query, ...periodQuery(period), evcNumberId: selectedNumberId };
  const page = useResource<TransactionPage>(`tx:${JSON.stringify(params)}`, () => api(`/transactions${qs({ ...params, limit: 30 })}`));
  useEffect(() => { setMore([]); setCursor(page.data?.nextCursor ?? null); }, [page.data]);
  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try { const r = await api<TransactionPage>(`/transactions${qs({ ...params, limit: 30, cursor })}`); setMore(p => [...p, ...r.items]); setCursor(r.nextCursor); }
    finally { setLoadingMore(false); }
  }
  const items = [...(page.data?.items ?? []), ...more];
  const groups: { key: string; label: string; full: string; items: Message[] }[] = [];
  for (const m of items) {
    const d = dayLabel(m.transaction!.occurredAt, tz);
    const g = groups[groups.length - 1];
    if (g?.key === d.key) g.items.push(m); else groups.push({ key: d.key, label: d.label, full: d.full, items: [m] });
  }
  const totals = page.data?.totals;
  const pill = (f: typeof filter, label: string, dot?: string) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
    className={`h-8 px-3 rounded-full font-label-ui text-label-ui flex items-center gap-1.5 shadow-sm transition-all ${filter === f ? 'bg-primary-container text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant'}`}>
    {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}<span>{label}</span>
    {f === 'all' && totals && <span className="px-1.5 rounded-full bg-surface-container-lowest/20 font-label-numeric-sm text-[10px]">{totals.incomingCount + totals.outgoingCount}</span>}
  </button>;

  return <>
    <Header subtitle="Dhaqdhaqaaq" msisdn={me!.evcNumbers.find(n => n.id === selectedNumberId)?.msisdn} />
    <Main>
      <div className="flex flex-col space-y-2.5">
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-on-surface-variant"><Icon name="search" className="text-[20px]" /></div>
          <input value={q} onChange={e => setQ(e.target.value)} aria-label="Raadi dhaqdhaqaaq" className="w-full pl-10 pr-10 py-2.5 bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-xl shadow-sm placeholder:text-on-surface-variant focus:outline-none" placeholder="Raadi magac, lambar, ama tixraac (Ref)..." type="search" />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            <button aria-label="Shaandhee taariikhda" onClick={() => setPeriodMenu(true)} className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface active:scale-95 transition-transform"><Icon name="tune" className="text-[18px]" /></button></div>
        </div>
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar py-0.5">
          <div className="flex items-center gap-1.5 shrink-0">{pill('all', 'Dhammaan')}{pill('in', 'Soo galay (+)', 'bg-primary-container')}{pill('out', 'Baxay (-)', 'bg-error')}</div>
          <button onClick={() => setPeriodMenu(true)} className="shrink-0 h-8 px-2.5 rounded-full bg-surface-container-low text-on-surface flex items-center gap-1 shadow-sm active:scale-95 transition-transform">
            <Icon name="calendar_today" className="text-secondary text-[16px]" /><span className="font-label-ui text-label-ui truncate max-w-[110px]">{periodLabel(period)}</span><Icon name="arrow_drop_down" className="text-[16px] text-on-surface-variant" /></button>
        </div>
      </div>

      <div className="w-full bg-surface-container-lowest rounded-xl p-3 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full bg-primary-fixed flex items-center justify-center shrink-0"><Icon name="south_west" className="text-primary text-[16px]" /></div>
          <div className="flex flex-col min-w-0"><span className="font-label-ui text-label-ui text-on-surface-variant truncate">Wadarta Soo gashay</span>
            <span data-testid="history-in" className="font-label-numeric-md text-label-numeric-md text-primary-container leading-tight">{totals ? money(totals.incoming, '+') : '—'}</span></div>
        </div>
        <div className="h-8 w-px bg-surface-container" />
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full bg-error-container flex items-center justify-center shrink-0"><Icon name="north_east" className="text-on-error-container text-[16px]" /></div>
          <div className="flex flex-col min-w-0 text-right"><span className="font-label-ui text-label-ui text-on-surface-variant truncate">Wadarta Baxday</span>
            <span data-testid="history-out" className="font-label-numeric-md text-label-numeric-md text-error leading-tight">{totals ? money(totals.outgoing, '-') : '—'}</span></div>
        </div>
      </div>

      {page.error && !page.data && <Banner tone="error" icon="cloud_off">{page.error.message}</Banner>}
      {!page.data && page.loading && <Spinner label="Dhaqdhaqaaqa waa la soo qaadayaa…" />}
      <div className="flex flex-col space-y-4">
        {groups.map((g, i) => <div key={g.key} className="flex flex-col space-y-2">
          <div className={`flex items-center justify-between px-1 ${i ? 'pt-2' : ''}`}>
            <div className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${g.label === 'Maanta' ? 'bg-primary' : 'bg-on-surface-variant/40'}`} />
              <span className="font-title-md text-title-md text-on-surface">{g.label}</span>{g.label !== g.full && <span className="font-body-sm text-body-sm text-on-surface-variant">— {g.full}</span>}</div>
            <span className="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">{g.items.length} dhaqdhaqaaq</span>
          </div>
          <div className="flex flex-col space-y-2">{g.items.map(m => <TxRow key={m.id} m={m} tz={tz} variant="list" />)}</div>
        </div>)}
      </div>
      {page.data && !items.length && <EmptyState icon="search_off" title="Wax dhaqdhaqaaq ah lama helin" text="Isku day inaad raadiso magac kale, lambar taleefan, ama hubi shaandhaynta aad dooratay." />}
      {cursor && <button disabled={loadingMore} onClick={loadMore} className="self-center px-4 py-2.5 rounded-full bg-surface-container text-on-surface-variant font-title-md text-title-md disabled:opacity-50">{loadingMore ? 'Waa la soo qaadayaa…' : 'Soo qaad kuwo hore'}</button>}

      <div className="w-full bg-surface-container-low rounded-xl p-3 shadow-sm flex items-start gap-2.5">
        <div className="w-6 h-6 rounded-full bg-secondary-fixed flex items-center justify-center shrink-0 mt-0.5"><Icon name="cloud_sync" className="text-on-secondary-fixed text-[15px]" /></div>
        <div className="flex flex-col"><span className="font-label-ui text-label-ui text-on-surface font-semibold">Isku xirnaanta Xogta</span>
          <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed mt-0.5">Kaliya dhaqdhaqaaqyada la xaqiijiyay ayaa halkan ku jira. Fariimaha sugaya iyo kuwa aan transaction ahayn laguma darin wadarta. Waqtiyada waxaa loo xisaabiyaa {tz}.</p></div>
      </div>
    </Main>
    <Sheet open={periodMenu} onClose={() => setPeriodMenu(false)} title="Muddada">
      {(['today', 'week', 'month', 'all'] as const).map(p => <button key={p} onClick={() => { setPeriod({ period: p }); setPeriodMenu(false); }}
        className={`flex items-center justify-between p-3 rounded-xl ${period.period === p ? 'bg-primary-fixed' : 'bg-surface-container-low'}`}><span className="font-title-md text-body-md">{periodLabel({ period: p })}</span>{period.period === p && <Icon name="check" />}</button>)}
      <button onClick={() => { setPeriodMenu(false); setCustomOpen(true); }} className="flex items-center gap-2 p-3 rounded-xl bg-surface-container-low"><Icon name="calendar_today" className="text-secondary" /><span className="font-title-md text-body-md">Taariikh dooro…</span></button>
    </Sheet>
    {customOpen && <DateRangeSheet open={customOpen} onClose={() => setCustomOpen(false)} value={period} onPick={setPeriod} tz={tz} />}
  </>;
}
