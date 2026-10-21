import { useState } from 'react';
import { PeriodChips, periodQuery } from '../components/PeriodPicker.tsx';
import { Banner, EmptyState, Group, Header, Icon, Main, SectionTitle, Sheet, Spinner, TxRow } from '../components/ui.tsx';
import { api, qs } from '../lib/api.ts';
import { ago, masked, money, shortDateTime } from '../lib/format.ts';
import { isNativeAndroid, TooshNative } from '../lib/native.ts';
import { navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll, useConnection, useResource } from '../lib/sync.ts';
import type { PeriodChoice, Summary } from '../lib/types.ts';

const STALE_BALANCE_MS = 24 * 3600 * 1000;

export function Guud() {
  const { me, tz, selectedNumberId, setSelectedNumberId, native, refreshNative, refreshMe } = useSession();
  const connection = useConnection();
  const [period, setPeriod] = useState<PeriodChoice>({ period: 'today' });
  const [pickNumber, setPickNumber] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const key = selectedNumberId ? `summary:${selectedNumberId}:${JSON.stringify(period)}` : null;
  const summary = useResource<Summary>(key, () => api(`/summary${qs({ ...periodQuery(period), evcNumberId: selectedNumberId })}`));
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
  let syncTitle = 'Isku-xirka: Guuleystay'; let syncIcon = 'check_circle'; let syncTone = 'text-primary-container';
  let syncDetail = '';
  if (!source) { syncTitle = 'Taleefanka asalka weli lama xirin'; syncIcon = 'phonelink_off'; syncTone = 'text-tertiary-container'; syncDetail = 'Ku xir taleefanka Android ee SIM-ka EVC leh si fariimaha loo helo.'; }
  else {
    const failed = thisIsSource ? native?.queue.failed ?? 0 : source.queueFailed ?? 0;
    const pending = thisIsSource ? (native?.queue.pending ?? 0) + (native?.queue.uploading ?? 0) : source.queuePending ?? 0;
    const permissionOff = thisIsSource ? native?.smsPermission !== 'GRANTED' : source.smsPermission === 'DENIED';
    const uploadAt = thisIsSource ? native?.lastUploadAt ?? source.lastUploadAt : source.lastUploadAt;
    if (permissionOff) { syncTitle = 'Ogolaanshaha SMS waa xiran yahay'; syncIcon = 'sms_failed'; syncTone = 'text-error'; }
    else if (thisIsSource && native?.authProblem) { syncTitle = 'Aaladdan lama aqbalin'; syncIcon = 'error'; syncTone = 'text-error'; }
    else if (failed > 0) { syncTitle = `${failed} fariimood way fashilmeen`; syncIcon = 'error'; syncTone = 'text-error'; }
    else if (pending > 0) { syncTitle = `${pending} fariimood ayaa sugaya dirid`; syncIcon = 'schedule'; syncTone = 'text-secondary'; }
    else if (!sourceActive) { syncTitle = 'Taleefanka asalka muddo ma soo xirmin'; syncIcon = 'cloud_off'; syncTone = 'text-tertiary-container'; }
    syncDetail = `La waafajiyay ${uploadAt ? shortDateTime(uploadAt, tz) : 'weli'} · La xiriiray ${ago(source.lastSeenAt)}`;
  }

  const stale = balance ? Date.now() - Date.parse(balance.effectiveAt) > STALE_BALANCE_MS : false;
  const sourceLabel = source ? (sourceActive ? 'Firfircoon' : 'Aamusan') : 'Ma xirna';
  const syncOk = syncIcon === 'check_circle';

  return <>
    <Header subtitle="Guud" msisdn={number?.msisdn} />
    <Main>
      <section className="hero-gradient relative overflow-hidden rounded-[28px] text-on-primary p-5 shadow-[0_18px_40px_-18px_rgba(5,71,42,0.75)]">
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full border-[28px] border-white/[0.04] pointer-events-none" />
        <button type="button" onClick={() => setPickNumber(true)} disabled={me!.evcNumbers.length < 2}
          className="relative flex items-center gap-2.5 w-full text-left disabled:cursor-default">
          <div className="w-9 h-9 rounded-full bg-white/12 flex items-center justify-center shrink-0"><Icon name="sim_card" className="text-[19px] text-on-primary-container" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold leading-[20px] truncate">{number ? masked(number.msisdn) : '—'}</div>
            <div className="text-[12px] leading-[16px] text-white/70 truncate">{number?.displayName ? `${number.displayName} · ` : ''}Hormuud EVC Plus</div>
          </div>
          <span className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white/12 text-[12px] font-semibold shrink-0">
            <span className={`w-2 h-2 rounded-full ${source ? (sourceActive ? 'bg-primary-fixed-dim' : 'bg-tertiary-fixed-dim') : 'bg-white/50'}`} />{sourceLabel}
            {me!.evcNumbers.length > 1 && <Icon name="expand_more" className="text-[16px] -mr-1" />}</span>
        </button>

        <div className="relative mt-6 text-[13px] font-medium text-white/75 flex items-center gap-1.5"><Icon name="account_balance_wallet" className="text-[16px]" />Haraaga EVC Plus</div>
        <div className="relative mt-1 flex items-baseline gap-2">
          <span data-testid="balance" className="text-[40px] leading-[46px] font-extrabold tracking-[-0.02em]">{balance ? money(balance.amount) : '—'}</span>
          <span className="text-[14px] font-semibold text-white/70">USD</span>
        </div>
        <p className="relative mt-1 text-[12.5px] leading-[17px] text-white/70">
          {balance ? <>SMS-kii u dambeeyay · {shortDateTime(balance.effectiveAt, tz)}{stale && <span className="text-tertiary-fixed-dim font-semibold"> · Xog hore — sug fariin cusub</span>}</>
            : 'Weli haraag lama helin. Wuxuu ka imaanayaa fariimaha EVC Plus.'}
        </p>
      </section>

      <div className="card flex items-center gap-3 pl-4 pr-2 py-2.5">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${syncOk ? 'bg-primary-fixed' : 'bg-surface-container-low'}`}><Icon name={syncIcon} fill className={`${syncTone} text-[20px]`} /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] leading-[20px] font-semibold text-on-surface truncate">{syncTitle}</div>
          {syncDetail && <div className="text-[12.5px] leading-[17px] text-on-surface-variant">{syncDetail}</div>}
        </div>
        {source ? <button aria-label="Dib u eeg fariimaha" onClick={refresh} className="w-11 h-11 rounded-full flex items-center justify-center text-primary-container active:bg-surface-container-low shrink-0">
          <Icon name="refresh" className={`text-[22px] ${refreshing ? 'animate-spin' : ''}`} /></button>
          : <button onClick={() => navigate('taleefanka-asalka')} className="h-9 px-3.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[13px] font-bold shrink-0 pressable">Dejin</button>}
      </div>
      {(connection === 'offline' || summary.stale) && <Banner tone="info" icon="cloud_off">Khadka wuu go'anyahay — xogtani waa tii ugu dambaysay{summary.savedAt ? ` (${shortDateTime(summary.savedAt, tz)})` : ''}.</Banner>}

      {s && s.pendingCount > 0 && <div className="rounded-[20px] bg-tertiary-fixed p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center shrink-0"><Icon name="pending_actions" className="text-on-tertiary text-[21px]" /></div>
          <div className="flex-1 min-w-0 pt-0.5">
            <span className="block text-[15px] leading-[20px] font-bold text-on-tertiary-fixed">{s.pendingCount} Fariimood waxay u baahan yihiin kala saarid</span>
            <span className="block text-[13px] leading-[18px] text-on-tertiary-fixed-variant mt-0.5">Laguma darin wadarta ilaa la kala saaro.</span>
          </div>
        </div>
        <button onClick={() => navigate('fariimaha/pending')} aria-label={`Kala saar hadda (${s.pendingCount})`} className="h-11 rounded-full bg-tertiary-container text-on-tertiary text-[14.5px] font-bold flex items-center justify-center gap-1.5 pressable">
          Kala saar hadda<Icon name="arrow_forward" className="text-[18px]" /></button>
      </div>}

      <PeriodChips value={period} onChange={setPeriod} tz={tz} />

      <div className="grid grid-cols-2 gap-3">
        {(['IN', 'OUT'] as const).map(dir => {
          const t = dir === 'IN' ? s?.incoming : s?.outgoing;
          const inn = dir === 'IN';
          return <div key={dir} className="card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${inn ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-error-container text-on-error-container'}`}>
                <Icon name={inn ? 'south_west' : 'north_east'} className="text-[18px]" /></div>
              <span className="text-[13.5px] font-semibold text-on-surface-variant">{inn ? 'Soo galay' : 'Baxay'}</span>
            </div>
            <div>
              <span data-testid={inn ? 'total-in' : 'total-out'} className={`block text-[22px] leading-[28px] font-extrabold tracking-tight ${inn ? 'text-primary-container' : 'text-on-surface'}`}>{t ? money(t.total, inn ? '+' : '-') : '—'}</span>
              <span className="text-[12.5px] text-on-surface-variant">{t ? `${t.count} jeer` : '—'}</span>
            </div>
          </div>;
        })}
      </div>

      <SectionTitle action={<a className="text-[14px] font-bold text-primary-container flex items-center active:opacity-70" href="#/dhaqdhaqaaq">Dhammaan<Icon name="chevron_right" className="text-[20px] -mr-1.5" /></a>}>
        Dhaqdhaqaaqyada</SectionTitle>
      {summary.error && !s && <Banner tone="error" icon="error">{summary.error.message}</Banner>}
      {!s && summary.loading && <Spinner label="Xogta waa la soo qaadayaa…" />}
      {s && !s.recent.length && <EmptyState icon="receipt_long" title="Weli wax dhaqdhaqaaq ah ma jiraan" text="Muddadan wax dhaqdhaqaaq ah oo la xaqiijiyay ma jiraan." />}
      {s && s.recent.length > 0 && <Group>{s.recent.map(m => <TxRow key={m.id} m={m} tz={tz} />)}</Group>}

      <div className="flex items-center justify-center gap-1.5 pt-1 pb-2 text-on-surface-variant/80">
        <Icon name="lock" className="text-[14px]" /><span className="text-[12px] text-center">Toosh ma diro lacag — kaliya wuxuu akhriyaa fariimaha EVC Plus.</span>
      </div>
    </Main>
    <Sheet open={pickNumber} onClose={() => setPickNumber(false)} title="Dooro lambarka EVC">
      {me!.evcNumbers.map(n => <button key={n.id} onClick={() => { setSelectedNumberId(n.id); setPickNumber(false); }}
        className={`flex items-center justify-between h-14 px-4 rounded-2xl ${n.id === selectedNumberId ? 'bg-primary-fixed' : 'bg-surface-container-low'}`}>
        <span className="text-[16px] font-bold">{masked(n.msisdn)}</span><span className="text-[14px] text-on-surface-variant">{n.displayName}</span></button>)}
    </Sheet>
  </>;
}
