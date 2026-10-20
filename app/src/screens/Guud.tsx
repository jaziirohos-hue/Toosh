import { useState } from 'react';
import { PeriodChips, periodQuery } from '../components/PeriodPicker.tsx';
import { Banner, Header, Icon, Main, Sheet, Spinner, TxRow } from '../components/ui.tsx';
import { api, qs } from '../lib/api.ts';
import { ago, masked, money, timeOfDay, shortDateTime } from '../lib/format.ts';
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
    syncDetail = `Xog la waafajiyay: ${uploadAt ? shortDateTime(uploadAt, tz) : 'weli'} • La xiriiray: ${ago(source.lastSeenAt)}`;
  }

  return <>
    <Header subtitle="Guud" msisdn={number?.msisdn} />
    <Main>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setPickNumber(true)} disabled={me!.evcNumbers.length < 2}
          className="flex items-center justify-between bg-surface-container-low px-3 py-2 rounded-xl shadow-sm text-left disabled:cursor-default">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary-container/10 flex items-center justify-center shrink-0"><Icon name="sim_card" className="text-primary-container text-[18px]" /></div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5"><span className="font-label-numeric-sm text-label-numeric-sm text-on-surface font-semibold truncate">{number ? masked(number.msisdn) : '—'}</span>
                {number?.displayName && <span className="font-body-sm text-body-sm text-on-surface-variant truncate">({number.displayName})</span>}</div>
              <span className="font-label-ui text-[10px] text-primary-container font-bold tracking-wide uppercase">Hormuud EVC Plus</span>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-surface-container-lowest px-2.5 py-1 rounded-full shadow-sm">
            <span className={`w-2 h-2 rounded-full ${source ? (sourceActive ? 'bg-primary-container' : 'bg-tertiary-container') : 'bg-outline'}`} />
            <span className="font-label-ui text-label-ui text-on-surface">{source ? (sourceActive ? 'Firfircoon' : 'Aamusan') : 'Ma xirna'}</span>
          </div>
        </button>
        <div className="flex items-center justify-between bg-surface-container-lowest px-3 py-2 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name={syncIcon} fill className={`${syncTone} text-[18px] shrink-0`} />
            <div className="flex flex-col min-w-0">
              <span className="font-body-sm text-body-sm text-on-surface font-medium truncate">{syncTitle}</span>
              <span className="font-label-ui text-[10px] text-on-surface-variant">{syncDetail}</span>
            </div>
          </div>
          {source ? <button aria-label="Dib u eeg fariimaha" onClick={refresh} className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-container-low text-primary-container active:scale-95 transition-transform shrink-0">
            <Icon name="sync" className={`text-[18px] ${refreshing ? 'animate-spin' : ''}`} /></button>
            : <button onClick={() => navigate('taleefanka-asalka')} className="font-label-ui text-label-ui text-secondary font-semibold shrink-0 px-2">Dejin</button>}
        </div>
        {(connection === 'offline' || summary.stale) && <div className="flex items-center gap-2 bg-surface-variant text-on-surface-variant px-3 py-1.5 rounded-lg shadow-sm">
          <Icon name="cloud_off" className="text-outline text-[16px]" />
          <span className="font-body-sm text-body-sm flex-1 truncate">Khadka wuu go'anyahay - xogtani waa tii ugu dambaysay{summary.savedAt ? ` (${shortDateTime(summary.savedAt, tz)})` : ''}</span>
        </div>}
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-primary-container text-on-primary p-4 shadow-md">
        <div className="absolute -right-6 -bottom-8 w-36 h-36 rounded-full bg-on-primary/5 pointer-events-none blur-2xl" />
        <div className="absolute right-3 top-3 opacity-15"><Icon name="account_balance_wallet" className="text-7xl text-on-primary pointer-events-none" style={{ fontSize: 72 }} /></div>
        <div className="relative z-10 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5"><Icon name="verified" className="text-on-primary-container text-[16px]" />
              <span className="font-label-ui text-label-ui uppercase tracking-wider text-on-primary-container font-semibold">Haraagii ugu dambeeyay (SMS)</span></div>
            {balance && <span className="font-label-numeric-sm text-[11px] text-on-primary/80 bg-on-primary/10 px-2 py-0.5 rounded-full">{shortDateTime(balance.effectiveAt, tz)}</span>}
          </div>
          <div className="flex items-baseline gap-2">
            <span data-testid="balance" className="font-headline-lg-mobile text-headline-lg-mobile font-bold tracking-tight text-on-primary">{balance ? money(balance.amount) : '—'}</span>
            <span className="font-label-ui text-label-ui text-on-primary-container font-medium">USD</span>
          </div>
          <div className="flex items-start gap-1.5 bg-on-primary/10 rounded-xl p-2.5">
            <Icon name="info" className="text-on-primary-container text-[16px] shrink-0 mt-0.5" />
            <p className="font-body-sm text-[11px] leading-tight text-on-primary/90">
              {balance ? <>Haraagani wuxuu toos uga yimid fariintii u dambaysay ee EVC Plus ({timeOfDay(balance.effectiveAt, tz)}), ma aha isku-darka xisaabta.
                {Date.now() - Date.parse(balance.effectiveAt) > STALE_BALANCE_MS && ' Xog hore ayay tahay — sug fariin cusub.'}</>
                : 'Weli haraag lama helin. Haraagu wuxuu ka yimaadaa fariimaha EVC Plus ee xaqiijiyay; looma xisaabiyo soo galay iyo baxay.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(['IN', 'OUT'] as const).map(dir => {
          const t = dir === 'IN' ? s?.incoming : s?.outgoing;
          return <div key={dir} className="flex flex-col justify-between bg-surface-container-lowest rounded-xl p-3 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="font-body-sm text-body-sm text-on-surface-variant font-medium">{dir === 'IN' ? 'Soo galay' : 'Baxay'}</span>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${dir === 'IN' ? 'bg-primary-fixed' : 'bg-error-container'}`}>
                <Icon name={dir === 'IN' ? 'south_west' : 'north_east'} className={`text-[14px] ${dir === 'IN' ? 'text-on-primary-fixed' : 'text-on-error-container'}`} /></div>
            </div>
            <div className="flex flex-col">
              <span data-testid={dir === 'IN' ? 'total-in' : 'total-out'} className={`font-label-numeric-lg text-label-numeric-lg font-bold ${dir === 'IN' ? 'text-primary-container' : 'text-error'}`}>{t ? money(t.total, dir === 'IN' ? '+' : '-') : '—'}</span>
              <div className="inline-flex items-center gap-1 mt-1 bg-surface-container-low px-2 py-0.5 rounded-md w-fit">
                <span className={`font-label-ui text-[10px] font-semibold ${dir === 'IN' ? 'text-primary-container' : 'text-error'}`}>{t ? `${t.count} jeer` : '—'}</span></div>
            </div>
          </div>;
        })}
      </div>

      {s && s.pendingCount > 0 && <div className="flex flex-col gap-2.5 bg-tertiary-fixed text-on-tertiary-fixed rounded-xl p-3.5 shadow-sm">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-full bg-tertiary-container flex items-center justify-center shrink-0 mt-0.5"><Icon name="schedule" className="text-on-tertiary text-[16px]" /></div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-title-md text-body-md font-bold text-on-tertiary-fixed leading-snug">{s.pendingCount} Fariimood waxay u baahan yihiin kala saarid</span>
            <p className="font-body-sm text-[11px] leading-normal text-on-tertiary-fixed-variant mt-0.5">Fariimaha aan la xaqiijin laguma darin wadarta lacagaha baxay ama soo galay.</p>
          </div>
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={() => navigate('fariimaha/pending')} className="inline-flex items-center gap-1.5 bg-tertiary-container text-on-tertiary px-3.5 py-1.5 rounded-lg text-label-ui font-label-ui active:scale-95 transition-transform shadow-sm">
            <span>Kala saar hadda ({s.pendingCount})</span><Icon name="arrow_forward" className="text-[14px]" /></button>
        </div>
      </div>}

      <PeriodChips value={period} onChange={setPeriod} tz={tz} />

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5"><h2 className="font-title-md text-title-md text-on-surface">Dhaqdhaqaaqyadii u dambeeyay</h2><span className="w-1.5 h-1.5 rounded-full bg-primary-container" /></div>
          <a className="font-label-ui text-label-ui text-secondary font-semibold hover:underline flex items-center gap-0.5 shrink-0" href="#/dhaqdhaqaaq"><span>Dhammaan eeg</span><Icon name="chevron_right" className="text-[14px]" /></a>
        </div>
        {summary.error && !s && <Banner tone="error" icon="error">{summary.error.message}</Banner>}
        {!s && summary.loading && <Spinner label="Xogta waa la soo qaadayaa…" />}
        {s && !s.recent.length && <p className="font-body-sm text-body-sm text-on-surface-variant bg-surface-container-lowest rounded-xl p-4 shadow-sm">Muddadan wax dhaqdhaqaaq ah oo la xaqiijiyay ma jiraan.</p>}
        <div className="flex flex-col gap-2">{s?.recent.map(m => <TxRow key={m.id} m={m} tz={tz} />)}</div>
      </div>
      <div className="flex items-center justify-center gap-1.5 py-2 text-on-surface-variant/70">
        <Icon name="lock" className="text-[14px]" /><span className="font-label-ui text-[10px] tracking-wide text-center">Toosh ma diro lacag, kaliya waxa uu falanqeeyaa fariimaha EVC Plus.</span>
      </div>
    </Main>
    <Sheet open={pickNumber} onClose={() => setPickNumber(false)} title="Dooro lambarka EVC">
      {me!.evcNumbers.map(n => <button key={n.id} onClick={() => { setSelectedNumberId(n.id); setPickNumber(false); }}
        className={`flex items-center justify-between p-3 rounded-xl ${n.id === selectedNumberId ? 'bg-primary-fixed' : 'bg-surface-container-low'}`}>
        <span className="font-label-numeric-md text-label-numeric-md">{masked(n.msisdn)}</span><span className="font-body-sm text-body-sm">{n.displayName}</span></button>)}
    </Sheet>
  </>;
}
