import { useEffect, useMemo, useState } from 'react';
import { formatMsisdn, validateClassification, zonedParts, zonedTimeToUtc } from '@toosh/shared';
import { Banner, Header, Icon, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { ISSUE_TEXT, fullDateTime, masked, money } from '../lib/format.ts';
import { discardEntry, enqueueClassification, overwriteWithMine } from '../lib/outbox.ts';
import { goBack } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { useConnection, useResource } from '../lib/sync.ts';
import type { HistoryEntry, Message } from '../lib/types.ts';
import { OutboxBadge, useOutbox } from './Fariimaha.tsx';

type Choice = 'incoming' | 'outgoing' | 'ignored' | null;

function toLocalInput(iso: string | null, tz: string) {
  if (!iso) return '';
  const p = zonedParts(new Date(iso), tz);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}:${z(p.second)}`;
}
function fromLocalInput(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  return zonedTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), tz).toISOString();
}

function formFrom(m: Message, tz: string) {
  const t = m.transaction;
  const choice: Choice = m.classification === 'NOT_TRANSACTION' ? 'ignored' : (t?.direction ?? m.parsed.direction) === 'IN' ? 'incoming' : (t?.direction ?? m.parsed.direction) === 'OUT' ? 'outgoing' : null;
  const phone = t ? t.counterpartyPhone : m.parsed.counterpartyPhone;
  const occurred = t && t.occurredAtSource !== 'RECEIPT_FALLBACK' ? t.occurredAt : m.parsed.occurredAt;
  return {
    choice, amount: t?.amount ?? m.parsed.amount ?? '', name: (t ? t.counterpartyName : m.parsed.counterpartyName) ?? '',
    phone: phone ? formatMsisdn(phone) : '', occurredAt: toLocalInput(occurred, tz), balance: m.balance?.amount ?? m.parsed.balance ?? '',
  };
}

const ACTION_TEXT: Record<string, string> = { INGEST: 'La soo geliyay', CLASSIFY: 'La kala saaray', REPROCESS: 'Parser-ka ayaa cusbooneysiiyay' };
const CLASS_TEXT: Record<string, string> = { PENDING: 'Sugaya', TRANSACTION: 'Transaction', NOT_TRANSACTION: 'Ma aha transaction' };

export function KalaSaar({ id }: { id: string }) {
  const { tz } = useSession();
  const connection = useConnection();
  const detail = useResource<{ message: Message; history: HistoryEntry[] }>(`message:${id}`, () => api(`/messages/${id}`));
  const outbox = useOutbox();
  const entry = outbox.find(e => e.messageId === id);
  const m = detail.data?.message;
  const [form, setForm] = useState<ReturnType<typeof formFrom> | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Follow the latest server copy until the person edits something; after that, live refreshes never overwrite
  // their input (a newer server version then shows the "changed elsewhere" notice instead).
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (m && !dirty) { setForm(formFrom(m, tz)); setBaseVersion(m.version); } }, [m, dirty, tz]);
  const onThisScreen = () => window.location.hash.includes(id);
  const changedElsewhere = m && baseVersion !== null && m.version !== baseVersion && !entry;

  const request = useMemo(() => {
    if (!form || baseVersion === null) return null;
    if (form.choice === 'ignored') return { classification: 'NOT_TRANSACTION' as const, expectedVersion: baseVersion };
    return {
      classification: 'TRANSACTION' as const, expectedVersion: baseVersion, direction: form.choice === 'incoming' ? 'IN' : form.choice === 'outgoing' ? 'OUT' : undefined,
      amount: form.amount.trim(), currency: 'USD', occurredAt: form.occurredAt ? fromLocalInput(form.occurredAt, tz) : null,
      counterpartyName: form.name.trim() || null, counterpartyPhone: form.phone.trim() || null, balance: form.balance.trim() || null,
    };
  }, [form, baseVersion, tz]);

  if (!m || !form) {
    return <><Header title="Faahfaahinta Dhaqdhaqaaqa" back={() => goBack('fariimaha')} />
      <main className="max-w-md mx-auto px-4 pt-header">{detail.error ? <Banner tone="error" icon="error">{detail.error.message}</Banner> : <Spinner label="Fariinta waa la soo qaadayaa…" />}</main></>;
  }

  async function save() {
    if (!request) return;
    if (!form!.choice) { setErrors({ direction: 'Dooro nooca dhaqdhaqaaqa.' }); return; }
    const v = validateClassification(request);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({}); setSaving(true); setNotice(null);
    let saved = false;
    await enqueueClassification(id, request, msg => { if (msg.id === id) { saved = true; setBaseVersion(msg.version); } });
    setSaving(false);
    if (saved) { setDirty(false); detail.reload(); if (onThisScreen()) goBack('fariimaha'); }
    else setNotice(connection === 'offline' ? 'Khadka ayaa go\'an. Isbeddelka waxaa lagu kaydiyay aaladdan, waxaana la diri doonaa marka khadku soo noqdo.' : null);
  }
  function keepTheirs() { setDirty(false); discardEntry(id); setForm(formFrom(entry?.current ?? m!, tz)); setBaseVersion((entry?.current ?? m!).version); detail.reload(); }
  function reloadLatest() { setDirty(false); setForm(formFrom(m!, tz)); setBaseVersion(m!.version); }

  const set = (k: keyof ReturnType<typeof formFrom>) => (e: React.ChangeEvent<HTMLInputElement>) => { setDirty(true); setForm(f => ({ ...f!, [k]: e.target.value })); };
  const issues = [...new Set([...(m.parsed.issues ?? []), ...(m.parsed.reviewReasons ?? [])])].filter(i => ISSUE_TEXT[i]);
  const typeCard = (choice: Exclude<Choice, null>, icon: string, title: string, en: string, sub: string, iconCls: string) => {
    const active = form.choice === choice;
    return <button type="button" role="radio" aria-checked={active} onClick={() => { setDirty(true); setForm(f => ({ ...f!, choice })); }}
      className={`w-full text-left px-4 py-3.5 flex items-center gap-3 transition-colors ${active ? 'bg-primary-fixed/70' : 'active:bg-surface-container-low'}`}>
      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${iconCls}`}><Icon name={icon} className="text-[22px]" /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[16px] font-bold text-on-surface flex items-center gap-1.5"><span>{title}</span>{en && <span className="text-[13px] font-medium text-on-surface-variant">{en}</span>}</div>
        <p className="text-[13px] leading-[18px] text-on-surface-variant">{sub}</p>
      </div>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${active ? 'bg-primary-container' : 'border-2 border-outline-variant'}`}>{active && <Icon name="check" className="text-[16px] text-on-primary" />}</div>
    </button>;
  };
  const label = 'block text-[13px] font-semibold text-on-surface-variant mb-1.5';
  const input = 'w-full h-[52px] bg-surface-container-low text-on-surface rounded-2xl border border-transparent focus:outline-none focus:border-primary-container focus:bg-surface-container-lowest transition-colors';
  const err = (k: string) => errors[k] ? <p role="alert" className="text-[13px] text-error mt-1.5">{errors[k]}</p> : null;
  const fallbackTime = !m.parsed.occurredAt && !form.occurredAt;

  return <>
    <Header title="Faahfaahinta Dhaqdhaqaaqa" back={() => goBack('fariimaha')} />
    <main className="flex-1 w-full max-w-md mx-auto px-4 pt-header pb-[calc(max(env(safe-area-inset-bottom,0px),12px)+96px)] bg-surface"><div className="screen-in flex flex-col w-full gap-4 pt-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {m.classification === 'PENDING' && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary-container opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" /></span>}
          <span className="text-[15px] font-bold text-on-surface">{m.classification === 'PENDING' ? 'Fariin Cusub' : 'Fariin'}</span><OutboxBadge entry={entry} />
        </div>
        <span className={`h-7 px-3 rounded-full text-[12px] font-bold flex items-center ${m.classification === 'PENDING' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : m.classification === 'TRANSACTION' ? (m.transaction!.direction === 'IN' ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-error-container text-on-error-container') : 'bg-surface-container text-on-surface-variant'}`}>
          {m.classification === 'PENDING' ? 'Ma cadda (Sugaya)' : m.classification === 'TRANSACTION' ? (m.transaction!.direction === 'IN' ? 'Soo galay' : 'Baxay') : 'Ma aha transaction'}</span>
      </div>

      {entry?.state === 'conflict' && entry.current && <section className="rounded-[20px] bg-tertiary-fixed p-4 flex flex-col gap-3" aria-label="Isku dhac">
        <div className="flex items-center gap-2 text-on-tertiary-fixed"><Icon name="sync_problem" /><h2 className="text-[16px] font-bold">Aalad kale ayaa beddeshay fariintan</h2></div>
        <p className="text-[14px] leading-[20px] text-on-tertiary-fixed-variant">Kaydka hadda jira: <strong>{CLASS_TEXT[entry.current.classification]}{entry.current.transaction ? ` · ${entry.current.transaction.direction === 'IN' ? 'Soo galay' : 'Baxay'} ${money(entry.current.transaction.amount)}` : ''}</strong>. Isbeddelkaaga: <strong>{entry.request.classification === 'NOT_TRANSACTION' ? 'Ma aha transaction' : `${entry.request.direction === 'IN' ? 'Soo galay' : 'Baxay'} ${money(String(entry.request.amount))}`}</strong>.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={keepTheirs} className="h-12 rounded-2xl bg-surface-container-lowest text-on-surface text-[15px] font-bold pressable">Hayso kooda</button>
          <button onClick={() => overwriteWithMine(id, () => { setDirty(false); detail.reload(); if (onThisScreen()) goBack('fariimaha'); })} className="h-12 rounded-2xl bg-tertiary-container text-on-tertiary text-[15px] font-bold pressable">Kaydi kayga</button>
        </div>
      </section>}
      {changedElsewhere && <div><Banner tone="warn" icon="sync_problem">Fariintan waa la beddelay inta aad furnayd. <button className="underline font-semibold" onClick={reloadLatest}>Soo qaad tan cusub</button> ama kaydi si aad u aragto isku dhaca.</Banner></div>}
      {entry?.state === 'failed' && <div><Banner tone="error" icon="error">{entry.error}</Banner></div>}
      {notice && <div><Banner tone="info" icon="cloud_queue">{notice}</Banner></div>}

      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-secondary-fixed text-secondary flex items-center justify-center"><Icon name="sms" className="text-[17px]" /></div><h2 className="text-[14px] font-bold text-on-surface">Fariinta asalka ah</h2></div>
          {m.simSlot !== null && <span className="h-6 px-2.5 rounded-full bg-surface-container text-on-surface-variant text-[12px] font-bold flex items-center">SIM {m.simSlot + 1}</span>}
        </div>
        <div data-testid="original-sms" className="sms-text bg-surface-container-low rounded-2xl px-3.5 py-3 text-on-surface select-all whitespace-pre-wrap break-words">{m.body}</div>
        <p className="mt-2.5 text-[12.5px] leading-[17px] text-on-surface-variant">Diraha: {m.sender} · La helay: {fullDateTime(m.receivedAt, tz)}{m.partsCount > 1 ? ` · ${m.partsCount} qaybood` : ''}</p>
        {issues.length > 0 && <div className="mt-3 flex items-start gap-2.5 bg-tertiary-fixed text-on-tertiary-fixed rounded-2xl px-3.5 py-3">
          <Icon name="warning" className="text-[19px] shrink-0 text-tertiary-container" />
          <ul className="text-[13.5px] leading-[19px] text-on-tertiary-fixed-variant list-none space-y-1">{issues.map(i => <li key={i}>{ISSUE_TEXT[i]}</li>)}</ul>
        </div>}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[17px] font-bold text-on-surface flex items-center justify-between"><span>Dooro nooca</span><span className="text-[12.5px] font-semibold text-on-surface-variant">Tallaabada 1aad</span></h3>
        <div className="card overflow-hidden divide-y divide-outline-variant/40" role="radiogroup" aria-label="Nooca dhaqdhaqaaqa">
          {typeCard('incoming', 'south_west', 'Soo galay', '(Incoming)', 'Lacag qof kale kaa soo gaartay', 'bg-primary-fixed text-on-primary-fixed-variant')}
          {typeCard('outgoing', 'north_east', 'Baxay', '(Outgoing)', 'Lacag aad dirtay ama wax ku iibsatay', 'bg-error-container text-on-error-container')}
          {typeCard('ignored', 'block', 'Ma aha transaction', '', 'Xayeysiis, digniin ama fariin kale', 'bg-surface-container text-on-surface-variant')}
        </div>
        {err('direction')}
      </section>

      <section className={`card p-4 transition-opacity duration-200 ${form.choice === 'ignored' ? 'opacity-40 pointer-events-none' : ''}`} aria-disabled={form.choice === 'ignored'}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-[17px] font-bold text-on-surface">Faahfaahinta</h3><span className="text-[12.5px] font-semibold text-on-surface-variant">La saxo karo</span></div>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); save(); }}>
          <div>
            <label className={label} htmlFor="tx-amount">Qaddarka Lacagta (Amount)</label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-[22px] font-extrabold text-primary-container">$</span>
              <input id="tx-amount" inputMode="decimal" value={form.amount} onChange={set('amount')} aria-invalid={Boolean(errors.amount)} className={`${input} !h-14 text-[24px] font-extrabold tracking-tight pl-10 pr-16`} />
              <span className="absolute right-4 text-[13px] font-bold text-on-surface-variant">USD</span>
            </div>{err('amount')}
          </div>
          <div>
            <label className={label} htmlFor="tx-name">Magaca Qofka / Ganacsiga</label>
            <div className="relative flex items-center">
              <Icon name="person" className="absolute left-4 text-on-surface-variant text-[20px]" />
              <input id="tx-name" value={form.name} onChange={set('name')} placeholder="Ikhtiyaari" className={`${input} text-[16px] font-semibold pl-12 pr-11`} />
              {form.name && <button type="button" aria-label="Tirtir magaca" onClick={() => { setDirty(true); setForm(f => ({ ...f!, name: '' })); }} className="absolute right-2 w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant active:bg-surface-container"><Icon name="close" className="text-[18px]" /></button>}
            </div>{err('counterpartyName')}
          </div>
          <div>
            <label className={label} htmlFor="tx-phone">Lambarka Taleefanka</label>
            <div className="relative flex items-center">
              <Icon name="call" className="absolute left-4 text-on-surface-variant text-[20px]" />
              <input id="tx-phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="Ikhtiyaari" className={`${input} text-[16px] font-semibold pl-12 pr-3`} />
            </div>{err('counterpartyPhone')}
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className={label} htmlFor="tx-date">Taariikhda &amp; Waqtiga</label>
              <input id="tx-date" type="datetime-local" step="1" value={form.occurredAt} onChange={set('occurredAt')} className={`${input} text-[15px] font-medium px-4`} />
              {err('occurredAt')}
            </div>
            <div>
              <label className={label} htmlFor="tx-balance">Haraagii SMS-ka</label>
              <div className="relative flex items-center">
                <span className="absolute left-4 text-[16px] font-bold text-on-surface-variant">$</span>
                <input id="tx-balance" inputMode="decimal" value={form.balance} onChange={set('balance')} placeholder="—" className={`${input} text-[16px] font-semibold pl-9 pr-3`} />
              </div>{err('balance')}
            </div>
          </div>
          {fallbackTime && <p className="text-[13px] leading-[18px] text-on-surface-variant">Fariintu waqti ma lahan. Haddii aad bannaan ka tagto, waqtiga taleefanku helay ({fullDateTime(m.receivedAt, tz)}) ayaa la isticmaali doonaa, waana la calaamadeyn doonaa.</p>}
        </form>
      </section>

      <section className="card overflow-hidden divide-y divide-outline-variant/40">
        <div className="px-4 py-3 flex items-center gap-3 text-on-surface-variant">
          <Icon name="cloud_sync" className="text-[18px] text-secondary shrink-0" />
          <p className="text-[13px] leading-[18px]"><span className="font-semibold text-on-surface">{m.classificationSource === 'MANUAL' ? 'Gacanta ayaa lagu kala saaray' : m.classification === 'PENDING' ? 'Weli lama kala saarin' : 'Si toos ah ayaa loo kala saaray'}</span> • Waxaa toos loogu dirayaa aaladahaaga kale.</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-3 text-on-surface-variant">
          <Icon name="verified_user" className="text-[18px] text-primary shrink-0" />
          <p className="text-[13px] leading-[18px]"><span className="font-semibold text-on-surface">SMS ID #{m.id.slice(0, 8).toUpperCase()}</span> • Waxaa laga hortagay in mar labaad la diiwaangeliyo.</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-3 text-on-surface-variant">
          <Icon name="cloud_done" className="text-[18px] text-primary shrink-0" />
          <p className="text-[13px] leading-[18px]"><span className="font-semibold text-on-surface">La waafajiyay</span> • Server-ka: {fullDateTime(m.uploadedAt, tz)} · {m.importMethod === 'INITIAL_IMPORT' ? 'Laga soo dejiyay fariimihii hore' : 'Fariin toos ah'}</p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)} className="w-full h-14 px-4 flex items-center justify-between text-[15.5px] font-bold text-on-surface active:bg-surface-container-low">
          <span>Taariikhda isbeddelka ({detail.data!.history.length})</span><Icon name={showHistory ? 'expand_less' : 'expand_more'} /></button>
        {showHistory && <ol className="divide-y divide-outline-variant/40 border-t border-outline-variant/40">{detail.data!.history.map((h, i) => <li key={i} className="px-4 py-3 text-[13px] leading-[18px]">
          <div className="flex justify-between gap-2"><span className="font-semibold text-on-surface">{ACTION_TEXT[h.action]} · v{h.toVersion}</span><span className="text-on-surface-variant">{fullDateTime(h.changedAt, tz)}</span></div>
          <p className="text-on-surface-variant mt-1">{h.actorDeviceName ?? 'Server'}{h.previous ? ` · Kahor: ${CLASS_TEXT[h.previous.classification]}${h.previous.amount ? ` ${money(h.previous.amount)}` : ''}${h.previous.counterpartyPhone ? ` ${masked(h.previous.counterpartyPhone)}` : ''}` : ''} → {CLASS_TEXT[h.next.classification]}{h.next.amount ? ` ${money(h.next.amount)}` : ''}</p>
        </li>)}</ol>}
      </section>
    </div></main>
    <div className="fixed bottom-0 inset-x-0 z-50 bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/40 pb-safe">
      <div className="max-w-md mx-auto px-4 pt-3 flex gap-2">
        <button onClick={() => goBack('fariimaha')} aria-label="Jooji" className="h-[52px] w-[52px] shrink-0 rounded-2xl bg-surface-container text-on-surface flex items-center justify-center pressable"><Icon name="close" className="text-[22px]" /></button>
        <button disabled={saving || entry?.state === 'conflict'} onClick={save} className="flex-1 h-[52px] bg-primary-container text-on-primary rounded-2xl text-[16px] font-bold shadow-[0_6px_16px_-6px_rgba(10,107,63,0.55)] flex items-center justify-center gap-2 pressable disabled:opacity-55">
          <Icon name={saving ? 'progress_activity' : 'check'} className={`text-[20px] ${saving ? 'animate-spin' : ''}`} /><span>{saving ? 'Waa la keydinayaa…' : 'Kaydi Dhaqdhaqaaqa'}</span></button>
      </div>
    </div>
  </>;
}
