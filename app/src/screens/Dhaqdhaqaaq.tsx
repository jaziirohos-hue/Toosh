import { useEffect, useState } from 'react';
import { DateRangeSheet, periodLabel, periodQuery } from '../components/PeriodPicker.tsx';
import { Banner, Button, EmptyState, Group, Header, Icon, Main, Sheet, Spinner, TxRow, useAmounts } from '../components/ui.tsx';
import { t } from '../lib/i18n.ts';
import { api, qs } from '../lib/api.ts';
import { dayLabel, money } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { useResource } from '../lib/sync.ts';
import type { Message, PeriodChoice, TransactionPage } from '../lib/types.ts';

export function Dhaqdhaqaaq() {
  const { me, tz, selectedNumberId } = useSession();
  const { show } = useAmounts();
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
  const seg = (f: typeof filter, label: string) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
    className={`grow min-h-9 py-1 px-3 rounded-full text-[13.5px] font-semibold whitespace-nowrap transition-all duration-200 ${filter === f ? 'bg-surface-container-lowest text-on-surface shadow-[0_1px_4px_rgba(14,26,19,0.14)]' : 'text-on-surface-variant'} leading-tight`}>{label}</button>;

  return <>
    <Header subtitle={t('Dhaqdhaqaaq', 'Activity')} msisdn={me!.evcNumbers.find(n => n.id === selectedNumberId)?.msisdn} />
    <Main>
      <div className="flex flex-col gap-3">
        <div className="relative flex items-center w-full">
          <Icon name="search" className="absolute left-4 text-on-surface-variant text-[22px] pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} aria-label={t('Raadi dhaqdhaqaaq', 'Search activity')} className="w-full min-h-12 py-2 pl-12 pr-12 rounded-full bg-surface-container-lowest border border-outline-variant/60 text-on-surface text-[15px] placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary-container leading-tight" placeholder={t('Raadi', 'Search')} type="search" />
          <button aria-label={t('Shaandhee taariikhda', 'Filter by date')} onClick={() => setPeriodMenu(true)} className="absolute right-1.5 w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant active:bg-surface-container"><Icon name="tune" className="text-[20px]" /></button>
        </div>
        <div className="flex flex-wrap gap-1 p-1 rounded-[22px] bg-surface-container">{seg('all', t('Dhammaan', 'All'))}{seg('in', t('Soo galay', 'Received'))}{seg('out', t('Baxay', 'Sent'))}</div>
      </div>

      <div className="card overflow-hidden">
        <button onClick={() => setPeriodMenu(true)} className="w-full flex items-center gap-2 px-4 h-12 border-b border-outline-variant/40 text-left active:bg-surface-container-low">
          <Icon name="calendar_month" className="text-primary-container text-[20px]" /><span className="flex-1 text-[14.5px] leading-snug font-bold text-on-surface">{periodLabel(period)}</span>
          <span className="text-[13px] font-semibold text-primary-container">{t('Beddel', 'Change')}</span><Icon name="expand_more" className="text-[20px] text-primary-container" /></button>
      <div className="grid grid-cols-1 @min-[330px]:grid-cols-2 divide-y @min-[330px]:divide-y-0 @min-[330px]:divide-x divide-outline-variant/40">
        <div className="p-4 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-on-surface-variant"><span className="w-6 h-6 rounded-full bg-primary-fixed text-on-primary-fixed-variant flex items-center justify-center"><Icon name="south_west" className="text-[15px]" /></span>{t('Soo galay', 'Received')}</span>
          <span data-testid="history-in" className="text-[clamp(17px,5.2cqw,20px)] leading-[1.3] font-extrabold tracking-tight break-all text-primary-container">{totals ? show(money(totals.incoming, '+')) : '—'}</span>
          <span className="text-[12px] text-on-surface-variant">{totals ? t(`${totals.incomingCount} jeer`, `${totals.incomingCount} times`) : ''}</span>
        </div>
        <div className="p-4 flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-on-surface-variant"><span className="w-6 h-6 rounded-full bg-error-container text-on-error-container flex items-center justify-center"><Icon name="north_east" className="text-[15px]" /></span>{t('Baxay', 'Sent')}</span>
          <span data-testid="history-out" className="text-[clamp(17px,5.2cqw,20px)] leading-[1.3] font-extrabold tracking-tight break-all text-on-surface">{totals ? show(money(totals.outgoing, '-')) : '—'}</span>
          <span className="text-[12px] text-on-surface-variant">{totals ? t(`${totals.outgoingCount} jeer`, `${totals.outgoingCount} times`) : ''}</span>
        </div>
      </div>
      </div>

      {page.error && !page.data && <Banner tone="error" icon="cloud_off">{page.error.message}</Banner>}
      {!page.data && page.loading && <Spinner label={t('Dhaqdhaqaaqa waa la soo qaadayaa…', 'Loading activity…')} />}
      {groups.map(g => <section key={g.key} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
          <h2 className="text-[15px] font-bold text-on-surface">{g.label}{g.label !== g.full && <span className="ml-1.5 text-[13px] font-medium text-on-surface-variant whitespace-nowrap">{g.full}</span>}</h2>
          <span className="text-[12.5px] text-on-surface-variant whitespace-nowrap">{g.items.length} {t('dhaqdhaqaaq', 'items')}</span>
        </div>
        <Group>{g.items.map(m => <TxRow key={m.id} m={m} tz={tz} variant="list" />)}</Group>
      </section>)}
      {page.data && !items.length && <EmptyState icon="search_off" title={t('Wax dhaqdhaqaaq ah lama helin', 'No activity found')} text={t('Isku day inaad raadiso magac kale, lambar taleefan, ama hubi shaandhaynta aad dooratay.', 'Try another name or phone number, or check the filter.')} />}
      {cursor && <Button kind="tonal" disabled={loadingMore} onClick={loadMore} className="self-center h-11 text-[14.5px]">{loadingMore ? t('Waa la soo qaadayaa…', 'Loading…') : t('Soo qaad kuwo hore', 'Load older')}</Button>}

      <p className="text-[12px] leading-[1.42] text-on-surface-variant/90 text-center px-4 pb-2">{t('Kaliya dhaqdhaqaaqyada la xaqiijiyay ayaa halkan ku jira. Fariimaha sugaya iyo kuwa aan transaction ahayn laguma darin wadarta. Waqtiga:', 'Only confirmed activity is listed. Messages waiting for review and non-transactions are not in the totals. Time zone:')} {tz}.</p>
    </Main>
    <Sheet open={periodMenu} onClose={() => setPeriodMenu(false)} title={t('Muddada', 'Period')}>
      {(['today', 'week', 'month', 'all'] as const).map(p => <button key={p} onClick={() => { setPeriod({ period: p }); setPeriodMenu(false); }}
        className={`flex items-center justify-between min-h-14 py-2 px-4 rounded-2xl pressable ${period.period === p ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-surface-container-low'} leading-tight`}><span className="text-[16px] font-semibold">{periodLabel({ period: p })}</span>{period.period === p && <Icon name="check_circle" fill />}</button>)}
      <button onClick={() => { setPeriodMenu(false); setCustomOpen(true); }} className="flex items-center gap-2.5 min-h-14 py-2 px-4 rounded-2xl bg-surface-container-low pressable leading-tight"><Icon name="date_range" className="text-primary-container" /><span className="text-[16px] font-semibold">{t('Taariikh dooro…', 'Pick dates…')}</span></button>
    </Sheet>
    {customOpen && <DateRangeSheet open={customOpen} onClose={() => setCustomOpen(false)} value={period} onPick={setPeriod} tz={tz} />}
  </>;
}
