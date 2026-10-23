import { useState } from 'react';
import { PeriodChips, periodQuery } from '../components/PeriodPicker.tsx';
import { CategoryIcon, cash, isZero, useCategories } from '../components/finance.tsx';
import { Banner, EmptyState, EyeToggle, Group, Header, Icon, Main, SectionTitle, Sheet, Spinner, TxRow, useAmounts } from '../components/ui.tsx';
import { t } from '../lib/i18n.ts';
import { BudgetAlerts, BudgetCard } from './Qarash.tsx';
import { api, qs } from '../lib/api.ts';
import { ago, masked, money, shortDateTime } from '../lib/format.ts';
import { isNativeAndroid, TooshNative } from '../lib/native.ts';
import { navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll, useConnection, useResource } from '../lib/sync.ts';
import type { FinanceSummary, PeriodChoice, Summary } from '../lib/types.ts';

const STALE_BALANCE_MS = 24 * 3600 * 1000;

export function Guud() {
  const { me, tz, selectedNumberId, setSelectedNumberId, native, refreshNative, refreshMe } = useSession();
  const connection = useConnection();
  const [period, setPeriod] = useState<PeriodChoice>({ period: 'today' });
  const [pickNumber, setPickNumber] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const key = selectedNumberId ? `summary:${selectedNumberId}:${JSON.stringify(period)}` : null;
  const summary = useResource<Summary>(key, () => api(`/summary${qs({ ...periodQuery(period), evcNumberId: selectedNumberId })}`));
  const finance = useResource<FinanceSummary>(`finance:${JSON.stringify(period)}`, () => api(`/finance${qs(periodQuery(period))}`));
  const { show } = useAmounts();
  const number = me!.evcNumbers.find(n => n.id === selectedNumberId) ?? null;
  const source = me!.devices.find(d => d.id === number?.sourceDeviceId) ?? null;
  const thisIsSource = Boolean(source?.current);
  const s = summary.data;
  const balance = s?.balances.find(b => b.evcNumberId === selectedNumberId) ?? null;
  const sourceActive = source?.lastSeenAt ? Date.now() - Date.parse(source.lastSeenAt) < 2 * 3600 * 1000 : false;

  async function refresh() {
    setRefreshing(true);
    try {
      if (thisIsSource && isNativeAndroid) await TooshNative.syncNow();
      await Promise.all([refreshMe(), refreshNative()]);
      invalidateAll();
    } finally { setTimeout(() => setRefreshing(false), 600); }
  }

  // Sync line: separates "last contact" from "last successful data sync", and shows this phone's own queue.
  let syncTitle = t('Isku-xirka: Guuleystay', 'Sync: OK'); let syncIcon = 'check_circle'; let syncTone = 'text-primary-container';
  let syncDetail = '';
  if (!source) { syncTitle = t('Taleefanka asalka weli lama xirin', 'No source phone connected yet'); syncIcon = 'phonelink_off'; syncTone = 'text-tertiary-container'; syncDetail = t('Ku xir taleefanka Android ee SIM-ka EVC leh si fariimaha loo helo.', 'Connect the Android phone with the EVC SIM to receive messages.'); }
  else {
    const failed = thisIsSource ? native?.queue.failed ?? 0 : source.queueFailed ?? 0;
    const pending = thisIsSource ? (native?.queue.pending ?? 0) + (native?.queue.uploading ?? 0) : source.queuePending ?? 0;
    const permissionOff = thisIsSource ? native?.smsPermission !== 'GRANTED' : source.smsPermission === 'DENIED';
    const uploadAt = thisIsSource ? native?.lastUploadAt ?? source.lastUploadAt : source.lastUploadAt;
    if (permissionOff) { syncTitle = t('Ogolaanshaha SMS waa xiran yahay', 'SMS permission is off'); syncIcon = 'sms_failed'; syncTone = 'text-error'; }
    else if (thisIsSource && native?.authProblem) { syncTitle = t('Aaladdan lama aqbalin', 'This device was not accepted'); syncIcon = 'error'; syncTone = 'text-error'; }
    else if (failed > 0) { syncTitle = t(`${failed} fariimood way fashilmeen`, `${failed} messages failed`); syncIcon = 'error'; syncTone = 'text-error'; }
    else if (pending > 0) { syncTitle = t(`${pending} fariimood ayaa sugaya dirid`, `${pending} messages waiting to send`); syncIcon = 'schedule'; syncTone = 'text-secondary'; }
    else if (!sourceActive) { syncTitle = t('Taleefanka asalka muddo ma soo xirmin', 'The source phone has not connected for a while'); syncIcon = 'cloud_off'; syncTone = 'text-tertiary-container'; }
    syncDetail = `${t('La waafajiyay', 'Synced')} ${uploadAt ? shortDateTime(uploadAt, tz) : t('weli', 'never')} · ${t('La xiriiray', 'Contacted')} ${ago(source.lastSeenAt)}`;
  }

  const stale = balance ? Date.now() - Date.parse(balance.effectiveAt) > STALE_BALANCE_MS : false;
  const sourceLabel = source ? (sourceActive ? t('Firfircoon', 'Active') : t('Aamusan', 'Quiet')) : t('Ma xirna', 'Not connected');
  const syncOk = syncIcon === 'check_circle';

  return <>
    <Header subtitle={t('Guud', 'Home')} msisdn={number?.msisdn} />
    <Main>
      <section className="hero-gradient relative overflow-hidden rounded-[28px] text-on-primary p-5 shadow-[0_18px_40px_-18px_rgba(5,71,42,0.75)]">
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full border-[28px] border-white/[0.04] pointer-events-none" />
        <button type="button" onClick={() => setPickNumber(true)} disabled={me!.evcNumbers.length < 2}
          className="relative flex flex-wrap items-center gap-x-2.5 gap-y-2 w-full text-left disabled:cursor-default">
          <div className="w-9 h-9 rounded-full bg-white/12 flex items-center justify-center shrink-0"><Icon name="sim_card" className="text-[19px] text-on-primary-container" /></div>
          <div className="flex-1 min-w-[150px]">
            <div className="text-[15px] font-bold leading-tight whitespace-nowrap">{number ? masked(number.msisdn) : '—'}</div>
            <div className="text-[12px] leading-[1.33] text-white/70 line-clamp-1 break-all">{number?.displayName ? `${number.displayName} · ` : ''}Hormuud EVC Plus</div>
          </div>
          <span className="flex items-center gap-1.5 min-h-7 py-0.5 px-2.5 rounded-full bg-white/12 text-[12px] font-semibold shrink-0 ml-auto leading-tight">
            <span className={`w-2 h-2 rounded-full ${source ? (sourceActive ? 'bg-primary-fixed-dim' : 'bg-tertiary-fixed-dim') : 'bg-white/50'}`} />{sourceLabel}
            {me!.evcNumbers.length > 1 && <Icon name="expand_more" className="text-[16px] -mr-1" />}</span>
        </button>

        <div className="relative mt-5 flex items-center gap-1.5 text-[13px] font-medium text-white/75"><Icon name="account_balance_wallet" className="text-[16px]" /><span className="flex-1">{t('Haraaga EVC Plus', 'EVC Plus balance')}</span>
          <EyeToggle className="-mr-2 -my-2 text-white/85 active:bg-white/10" /></div>
        <div className="relative mt-1 flex items-baseline gap-2">
          <span data-testid="balance" className="text-[clamp(24px,12.5cqw,40px)] leading-[1.25] whitespace-nowrap font-extrabold tracking-[-0.02em]">{balance ? show(money(balance.amount)) : '—'}</span>
          <span className="text-[14px] font-semibold text-white/70">USD</span>
        </div>
        <p className="relative mt-1 text-[12.5px] leading-[1.36] text-white/70">
          {balance ? <>{t('SMS-kii u dambeeyay', 'Latest SMS')} · {shortDateTime(balance.effectiveAt, tz)}{stale && <span className="text-tertiary-fixed-dim font-semibold"> · {t('Xog hore — sug fariin cusub', 'Old — wait for a new message')}</span>}</>
            : t('Weli haraag lama helin. Wuxuu ka imaanayaa fariimaha EVC Plus.', 'No balance yet. It comes from EVC Plus messages.')}
        </p>
      </section>

      <div className="card flex items-center gap-3 pl-4 pr-2 py-2.5">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${syncOk ? 'bg-primary-fixed' : 'bg-surface-container-low'}`}><Icon name={syncIcon} fill className={`${syncTone} text-[20px]`} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] leading-[1.38] font-semibold text-on-surface break-words">{syncTitle}</div>
          {syncDetail && <div className="text-[12.5px] leading-[1.36] text-on-surface-variant">{syncDetail}</div>}
        </div>
        {source ? <button aria-label={t('Dib u eeg fariimaha', 'Check for messages')} onClick={refresh} className="w-11 h-11 rounded-full flex items-center justify-center text-primary-container active:bg-surface-container-low shrink-0">
          <Icon name="refresh" className={`text-[22px] ${refreshing ? 'animate-spin' : ''}`} /></button>
          : <button onClick={() => navigate('taleefanka-asalka')} className="min-h-9 py-1 px-3.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[13px] font-bold shrink-0 pressable leading-tight">{t('Dejin', 'Set up')}</button>}
      </div>
      {(connection === 'offline' || summary.stale) && <Banner tone="info" icon="cloud_off">{t("Khadka wuu go'anyahay — xogtani waa tii ugu dambaysay", 'Offline — this is the last saved data')}{summary.savedAt ? ` (${shortDateTime(summary.savedAt, tz)})` : ''}.</Banner>}

      {s && s.pendingCount > 0 && <div className="rounded-[20px] bg-tertiary-fixed p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center shrink-0"><Icon name="pending_actions" className="text-on-tertiary text-[21px]" /></div>
          <div className="flex-1 min-w-0 pt-0.5">
            <span className="block text-[15px] leading-[1.33] font-bold text-on-tertiary-fixed">{t(`${s.pendingCount} Fariimood waxay u baahan yihiin kala saarid`, `${s.pendingCount} messages need review`)}</span>
            <span className="block text-[13px] leading-[1.38] text-on-tertiary-fixed-variant mt-0.5">{t('Laguma darin wadarta ilaa la kala saaro.', 'Not counted in totals until reviewed.')}</span>
          </div>
        </div>
        <button onClick={() => navigate('fariimaha/pending')} aria-label={`Kala saar hadda (${s.pendingCount})`} className="min-h-11 py-1.5 rounded-full bg-tertiary-container text-on-tertiary text-[14.5px] font-bold flex items-center justify-center gap-1.5 pressable leading-tight">
          {t('Kala saar hadda', 'Review now')}<Icon name="arrow_forward" className="text-[18px]" /></button>
      </div>}

      <PeriodChips value={period} onChange={setPeriod} tz={tz} />

      <div className="grid grid-cols-1 @min-[330px]:grid-cols-2 gap-3">
        {(['IN', 'OUT'] as const).map(dir => {
          const tot = dir === 'IN' ? s?.incoming : s?.outgoing;
          const inn = dir === 'IN';
          return <div key={dir} className="card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${inn ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-error-container text-on-error-container'}`}>
                <Icon name={inn ? 'south_west' : 'north_east'} className="text-[18px]" /></div>
              <span className="text-[13.5px] font-semibold text-on-surface-variant">{inn ? t('Soo galay', 'Received') : t('Baxay', 'Sent')}</span>
            </div>
            <div>
              <span data-testid={inn ? 'total-in' : 'total-out'} className={`block text-[clamp(18px,5.6cqw,22px)] leading-[1.25] font-extrabold tracking-tight break-all ${inn ? 'text-primary-container' : 'text-on-surface'}`}>{tot ? show(money(tot.total, inn ? '+' : '-')) : '—'}</span>
              <span className="text-[12.5px] text-on-surface-variant">{tot ? t(`${tot.count} jeer`, `${tot.count} times`) : '—'}</span>
            </div>
          </div>;
        })}
      </div>

      {finance.data && <MoneyOverview f={finance.data} />}

      <SectionTitle action={<a className="text-[14px] font-bold text-primary-container flex items-center active:opacity-70" href="#/dhaqdhaqaaq">{t('Dhammaan', 'All')}<Icon name="chevron_right" className="text-[20px]" /></a>}>
        {t('Dhaqdhaqaaqyada', 'Activity')}</SectionTitle>
      {summary.error && !s && <Banner tone="error" icon="error">{summary.error.message}</Banner>}
      {!s && summary.loading && <Spinner label={t('Xogta waa la soo qaadayaa…', 'Loading…')} />}
      {s && !s.recent.length && <EmptyState icon="receipt_long" title={t('Weli wax dhaqdhaqaaq ah ma jiraan', 'No activity yet')} text={t('Muddadan wax dhaqdhaqaaq ah oo la xaqiijiyay ma jiraan.', 'No confirmed activity in this period.')} />}
      {s && s.recent.length > 0 && <Group>{s.recent.map(m => <TxRow key={m.id} m={m} tz={tz} />)}</Group>}

      <div className="flex items-center justify-center gap-1.5 pt-1 pb-2 text-on-surface-variant/80">
        <Icon name="lock" className="text-[14px]" /><span className="text-[12px] text-center">{t('Toosh ma diro lacag — kaliya wuxuu akhriyaa fariimaha EVC Plus.', 'Toosh never sends money — it only reads EVC Plus messages.')}</span>
      </div>
    </Main>
    <Sheet open={pickNumber} onClose={() => setPickNumber(false)} title={t('Dooro lambarka EVC', 'Choose EVC number')}>
      {me!.evcNumbers.map(n => <button key={n.id} onClick={() => { setSelectedNumberId(n.id); setPickNumber(false); }}
        className={`flex items-center justify-between min-h-14 py-2 px-4 rounded-2xl ${n.id === selectedNumberId ? 'bg-primary-fixed' : 'bg-surface-container-low'} leading-tight`}>
        <span className="text-[16px] font-bold">{masked(n.msisdn)}</span><span className="text-[14px] text-on-surface-variant">{n.displayName}</span></button>)}
    </Sheet>
  </>;
}

/** Income, spending and what is left (all EVC numbers + hand-entered expenses), by category and against budgets. */
function MoneyOverview({ f }: { f: FinanceSummary }) {
  const { show } = useAmounts();
  const cats = useCategories();
  const sos = !isZero(f.expenses.SOS) || !isZero(f.unpaid.SOS) || !isZero(f.spendingMonth.SOS);
  const negative = f.remaining.USD.startsWith('-');
  const max = (cur: string) => f.categories.filter(c => c.currency === cur).reduce((m, c) => Math.max(m, Number(c.amount)), 0) || 1;
  const top = f.categories.slice(0, 6);
  return <>
    <SectionTitle action={<a className="text-[14px] font-bold text-primary-container flex items-center active:opacity-70" href="#/qarash">{t('Qarash', 'Expenses')}<Icon name="chevron_right" className="text-[20px]" /></a>}>
      {t('Lacagtaada', 'Your money')}</SectionTitle>
    <div className="card overflow-hidden">
      <div className="grid grid-cols-1 @min-[360px]:grid-cols-3 divide-y @min-[360px]:divide-y-0 @min-[360px]:divide-x divide-outline-variant/40">
        {([['income', t('Dakhli', 'Income'), 'south_west', 'text-primary-container', f.income.USD, '+'],
          ['expenses', t('Qarash', 'Expenses'), 'north_east', 'text-on-surface', f.expenses.USD, '-'],
          ['remaining', t('Hadhay', 'Remaining'), 'account_balance', negative ? 'text-error' : 'text-on-surface', f.remaining.USD, '']] as const).map(([k, label, icon, cls, v, sign]) =>
          <div key={k} className="p-4 flex flex-col gap-1 min-w-0">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-on-surface-variant"><Icon name={icon} className="text-[16px]" />{label}</span>
            <span data-testid={`fin-${k}`} className={`text-[clamp(17px,5.4cqw,20px)] leading-[1.3] font-extrabold tracking-tight break-all ${cls}`}>{show(cash(v, 'USD', sign as '' | '+' | '-'))}</span>
          </div>)}
      </div>
      {sos && <div className="px-4 py-2.5 border-t border-outline-variant/40 text-[13px] text-on-surface-variant flex flex-wrap gap-x-3">
        <span>{t('Qarash SOS', 'SOS spent')}: <strong className="text-on-surface">{show(cash(f.expenses.SOS, 'SOS'))}</strong></span></div>}
      {(!isZero(f.unpaid.USD) || !isZero(f.unpaid.SOS)) && <div className="px-4 py-2.5 border-t border-outline-variant/40 text-[13px] text-tertiary-container font-semibold flex items-center gap-1.5">
        <Icon name="schedule" className="text-[16px]" />{t('Biilal aan la bixin', 'Unpaid bills')}: {[!isZero(f.unpaid.USD) && show(cash(f.unpaid.USD, 'USD')), !isZero(f.unpaid.SOS) && show(cash(f.unpaid.SOS, 'SOS'))].filter(Boolean).join(' · ')}</div>}
      <div className="grid grid-cols-3 border-t border-outline-variant/40 bg-surface-container-low/60">
        {([[t('Maanta', 'Today'), f.spendingToday], [t('Toddobaadkan', 'This week'), f.spendingWeek], [t('Bishan', 'This month'), f.spendingMonth]] as const).map(([label, v]) =>
          <div key={label} className="px-2 py-3 flex flex-col items-center text-center gap-0.5 min-w-0">
            <span className="text-[12px] text-on-surface-variant leading-tight">{label}</span>
            <span className="text-[14px] font-bold text-on-surface break-all leading-tight">{show(cash(v.USD, 'USD'))}</span>
            {!isZero(v.SOS) && <span className="text-[11.5px] font-semibold text-on-surface-variant break-all leading-tight">{show(cash(v.SOS, 'SOS'))}</span>}
          </div>)}
      </div>
    </div>
    <p className="px-1 -mt-2 text-[12px] leading-[1.36] text-on-surface-variant">{t('Dakhliga iyo qarashka EVC waa dhammaan lambarada akoonka; qarashaadka gacanta waa la daray. Lacagaha aan la bixin laguma darin.', 'EVC income and spending cover every number on the account, plus expenses you add. Unpaid items are not counted.')}</p>

    <BudgetAlerts budgets={f.budgets} cats={cats} />
    {top.length > 0 && <div className="card p-4 flex flex-col gap-3" aria-label={t('Qarashka qaybaha', 'Spending by category')}>
      <span className="text-[14px] font-bold text-on-surface">{t('Qarashka qaybaha', 'Spending by category')}</span>
      {top.map(c => { const info = cats.get(c.category); const w = Math.max(3, (Number(c.amount) / max(c.currency)) * 100);
        return <div key={`${c.category}|${c.currency}`} className="flex items-center gap-3">
          <CategoryIcon size="sm" info={info} />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap justify-between gap-x-2 text-[13.5px]"><span className="font-semibold text-on-surface break-words">{info.label}</span><span className="font-bold text-on-surface whitespace-nowrap">{show(cash(c.amount, c.currency))}</span></div>
            <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div className={`h-full rounded-full ${info.bar}`} style={{ width: `${w}%` }} /></div>
          </div></div>; })}
    </div>}
    {f.budgets.length > 0 && <Group>{f.budgets.slice(0, 3).map(b => <BudgetCard key={b.id} b={b} cats={cats} onClick={() => navigate('qarash/miisaaniyad')} />)}</Group>}
  </>;
}
