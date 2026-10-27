import { useEffect, useMemo, useState } from 'react';
import { formatMsisdn, validateClassification, zonedParts, zonedTimeToUtc } from '@toosh/shared';
import { Banner, Header, Icon, Sheet, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { issueText, fullDateTime, masked, money } from '../lib/format.ts';
import { discardEntry, enqueueClassification, overwriteWithMine } from '../lib/outbox.ts';
import { goBack } from '../lib/router.ts';
import { serverDetails } from '../lib/serverText.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll, useConnection, useResource } from '../lib/sync.ts';
import type { HistoryEntry, Message } from '../lib/types.ts';
import { OutboxBadge, useOutbox } from './Fariimaha.tsx';
import { CategoryGrid, CategoryIcon, offlineAware, useCategories } from '../components/finance.tsx';
import { t } from '../lib/i18n.ts';

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

const actionText = (a: string) => ({ INGEST: t('La soo geliyay', 'Received'), CLASSIFY: t('La kala saaray', 'Classified'), REPROCESS: t('Parser-ka ayaa cusbooneysiiyay', 'Re-read by the parser') } as Record<string, string>)[a] ?? a;
const classText = (c: string) => ({ PENDING: t('Sugaya', 'Waiting'), TRANSACTION: 'Transaction', NOT_TRANSACTION: t('Ma aha transaction', 'Not a transaction') } as Record<string, string>)[c] ?? c;

export function KalaSaar({ id }: { id: string }) {
  const { tz } = useSession();
  const connection = useConnection();
  const detail = useResource<{ message: Message; history: HistoryEntry[]; category?: string | null }>(`message:${id}`, () => api(`/messages/${id}`));
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
    return <><Header title={t('Faahfaahin', 'Details')} back={() => goBack('fariimaha')} />
      <main className="max-w-md mx-auto px-4 pt-header">{detail.error ? <Banner tone="error" icon="error">{detail.error.message}</Banner> : <Spinner label={t('Fariinta waa la soo qaadayaa…', 'Loading message…')} />}</main></>;
  }

  async function save() {
    if (!request) return;
    if (!form!.choice) { setErrors({ direction: t('Dooro nooca dhaqdhaqaaqa.', 'Choose the type.') }); return; }
    const v = validateClassification(request);
    if (!v.ok) { setErrors(serverDetails(v.errors)); return; }
    setErrors({}); setSaving(true); setNotice(null);
    let saved = false;
    await enqueueClassification(id, request, msg => { if (msg.id === id) { saved = true; setBaseVersion(msg.version); } });
    setSaving(false);
    if (saved) { setDirty(false); detail.reload(); if (onThisScreen()) goBack('fariimaha'); }
    else setNotice(connection === 'offline' ? t('Khadka ayaa go\'an. Isbeddelka waxaa lagu kaydiyay aaladdan, waxaana la diri doonaa marka khadku soo noqdo.', 'You are offline. The change is saved on this device and will be sent when you are back online.') : null);
  }
  function keepTheirs() { setDirty(false); discardEntry(id); setForm(formFrom(entry?.current ?? m!, tz)); setBaseVersion((entry?.current ?? m!).version); detail.reload(); }
  function reloadLatest() { setDirty(false); setForm(formFrom(m!, tz)); setBaseVersion(m!.version); }

  const set = (k: keyof ReturnType<typeof formFrom>) => (e: React.ChangeEvent<HTMLInputElement>) => { setDirty(true); setForm(f => ({ ...f!, [k]: e.target.value })); };
  const issues = [...new Set([...(m.parsed.issues ?? []), ...(m.parsed.reviewReasons ?? [])])].filter(i => issueText(i));
  const typeCard = (choice: Exclude<Choice, null>, icon: string, title: string, en: string, sub: string, iconCls: string) => {
    const active = form.choice === choice;
    return <button type="button" role="radio" aria-checked={active} onClick={() => { setDirty(true); setForm(f => ({ ...f!, choice })); }}
      className={`w-full text-left px-4 py-3.5 flex items-center gap-3 transition-colors ${active ? 'bg-primary-fixed/70' : 'active:bg-surface-container-low'}`}>
      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${iconCls}`}><Icon name={icon} className="text-[22px]" /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[16px] font-bold text-on-surface flex items-center gap-1.5"><span>{title}</span>{en && <span className="text-[13px] font-medium text-on-surface-variant">{en}</span>}</div>
        <p className="text-[13px] leading-[1.38] text-on-surface-variant">{sub}</p>
      </div>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${active ? 'bg-primary-container' : 'border-2 border-outline-variant'}`}>{active && <Icon name="check" className="text-[16px] text-on-primary" />}</div>
    </button>;
  };
  const label = 'block text-[13px] font-semibold text-on-surface-variant mb-1.5';
  const input = 'w-full h-[52px] bg-surface-container-low text-on-surface rounded-2xl border border-transparent focus:outline-none focus:border-primary-container focus:bg-surface-container-lowest transition-colors';
  const err = (k: string) => errors[k] ? <p role="alert" className="text-[13px] text-error mt-1.5">{errors[k]}</p> : null;
  const fallbackTime = !m.parsed.occurredAt && !form.occurredAt;

  return <>
    <Header title={t('Faahfaahin', 'Details')} back={() => goBack('fariimaha')} />
    <main className="flex-1 w-full max-w-md mx-auto px-4 pt-header pb-[calc(max(env(safe-area-inset-bottom,0px),12px)+96px)] bg-surface"><div className="screen-in flex flex-col w-full gap-4 pt-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {m.classification === 'PENDING' && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary-container opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" /></span>}
          <span className="text-[15px] font-bold text-on-surface">{m.classification === 'PENDING' ? t('Fariin Cusub', 'New message') : t('Fariin', 'Message')}</span><OutboxBadge entry={entry} />
        </div>
        <span className={`min-h-7 py-0.5 px-3 rounded-full text-[12px] font-bold flex items-center ${m.classification === 'PENDING' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : m.classification === 'TRANSACTION' ? (m.transaction!.direction === 'IN' ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-error-container text-on-error-container') : 'bg-surface-container text-on-surface-variant'} leading-tight`}>
          {m.classification === 'PENDING' ? t('Ma cadda (Sugaya)', 'Unclear (waiting)') : m.classification === 'TRANSACTION' ? (m.transaction!.direction === 'IN' ? t('Soo galay', 'Received') : t('Baxay', 'Sent')) : t('Ma aha transaction', 'Not a transaction')}</span>
      </div>

      {entry?.state === 'conflict' && entry.current && <section className="rounded-[20px] bg-tertiary-fixed p-4 flex flex-col gap-3" aria-label={t('Isku dhac', 'Conflict')}>
        <div className="flex items-center gap-2 text-on-tertiary-fixed"><Icon name="sync_problem" /><h2 className="text-[16px] font-bold">{t('Aalad kale ayaa beddeshay fariintan', 'Another device changed this message')}</h2></div>
        <p className="text-[14px] leading-[1.43] text-on-tertiary-fixed-variant">{t('Kaydka hadda jira:', 'Saved now:')} <strong>{classText(entry.current.classification)}{entry.current.transaction ? ` · ${entry.current.transaction.direction === 'IN' ? t('Soo galay', 'Received') : t('Baxay', 'Sent')} ${money(entry.current.transaction.amount)}` : ''}</strong>. {t('Isbeddelkaaga:', 'Your change:')} <strong>{entry.request.classification === 'NOT_TRANSACTION' ? t('Ma aha transaction', 'Not a transaction') : `${entry.request.direction === 'IN' ? t('Soo galay', 'Received') : t('Baxay', 'Sent')} ${money(String(entry.request.amount))}`}</strong>.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={keepTheirs} className="min-h-12 py-2 rounded-2xl bg-surface-container-lowest text-on-surface text-[15px] font-bold pressable leading-tight">{t('Hayso kooda', 'Keep theirs')}</button>
          <button onClick={() => overwriteWithMine(id, () => { setDirty(false); detail.reload(); if (onThisScreen()) goBack('fariimaha'); })} className="min-h-12 py-2 rounded-2xl bg-tertiary-container text-on-tertiary text-[15px] font-bold pressable leading-tight">{t('Kaydi kayga', 'Save mine')}</button>
        </div>
      </section>}
      {changedElsewhere && <div><Banner tone="warn" icon="sync_problem">{t('Fariintan waa la beddelay inta aad furnayd.', 'This message changed while you had it open.')} <button className="underline font-semibold" onClick={reloadLatest}>{t('Soo qaad tan cusub', 'Load the latest')}</button> {t('ama kaydi si aad u aragto isku dhaca.', 'or save to see the conflict.')}</Banner></div>}
      {entry?.state === 'failed' && <div><Banner tone="error" icon="error">{entry.error}</Banner></div>}
      {notice && <div><Banner tone="info" icon="cloud_queue">{notice}</Banner></div>}

      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-secondary-fixed text-secondary flex items-center justify-center"><Icon name="sms" className="text-[17px]" /></div><h2 className="text-[14px] font-bold text-on-surface">{t('Fariinta asalka ah', 'Original message')}</h2></div>
          {m.simSlot !== null && <span className="min-h-6 py-0.5 px-2.5 rounded-full bg-surface-container text-on-surface-variant text-[12px] font-bold flex items-center leading-tight">SIM {m.simSlot + 1}</span>}
        </div>
        <div data-testid="original-sms" className="sms-text bg-surface-container-low rounded-2xl px-3.5 py-3 text-on-surface select-all whitespace-pre-wrap break-words">{m.body}</div>
        <p className="mt-2.5 text-[12.5px] leading-[1.36] text-on-surface-variant">{t('Diraha', 'Sender')}: {m.sender} · {t('La helay', 'Received')}: {fullDateTime(m.receivedAt, tz)}{m.partsCount > 1 ? ` · ${m.partsCount} ${t('qaybood', 'parts')}` : ''}</p>
        {issues.length > 0 && <div className="mt-3 flex items-start gap-2.5 bg-tertiary-fixed text-on-tertiary-fixed rounded-2xl px-3.5 py-3">
          <Icon name="warning" className="text-[19px] shrink-0 text-tertiary-container" />
          <ul className="text-[13.5px] leading-[1.41] text-on-tertiary-fixed-variant list-none space-y-1">{issues.map(i => <li key={i}>{issueText(i)}</li>)}</ul>
        </div>}
      </section>

      {m.classification === 'TRANSACTION' && m.transaction?.direction === 'OUT' && <TxCategory messageId={m.id} value={detail.data?.category ?? null} onSaved={detail.reload} />}

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-[17px] font-bold text-on-surface flex items-center justify-between"><span>{t('Dooro nooca', 'Choose the type')}</span><span className="text-[12.5px] font-semibold text-on-surface-variant">{t('Tallaabada 1aad', 'Step 1')}</span></h3>
        <div className="card overflow-hidden divide-y divide-outline-variant/40" role="radiogroup" aria-label={t('Nooca dhaqdhaqaaqa', 'Transaction type')}>
          {typeCard('incoming', 'south_west', t('Soo galay', 'Received'), t('(Incoming)', ''), t('Lacag qof kale kaa soo gaartay', 'Money someone sent you'), 'bg-primary-fixed text-on-primary-fixed-variant')}
          {typeCard('outgoing', 'north_east', t('Baxay', 'Sent'), t('(Outgoing)', ''), t('Lacag aad dirtay ama wax ku iibsatay', 'Money you sent or paid'), 'bg-error-container text-on-error-container')}
          {typeCard('ignored', 'block', t('Ma aha transaction', 'Not a transaction'), '', t('Xayeysiis, digniin ama fariin kale', 'Advert, notice or other message'), 'bg-surface-container text-on-surface-variant')}
        </div>
        {err('direction')}
      </section>

      <section className={`card p-4 transition-opacity duration-200 ${form.choice === 'ignored' ? 'opacity-40 pointer-events-none' : ''}`} aria-disabled={form.choice === 'ignored'}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-[17px] font-bold text-on-surface">{t('Faahfaahinta', 'Details')}</h3><span className="text-[12.5px] font-semibold text-on-surface-variant">{t('La saxo karo', 'Editable')}</span></div>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); save(); }}>
          <div>
            <label className={label} htmlFor="tx-amount">{t('Qaddarka Lacagta (Amount)', 'Amount')}</label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-[22px] font-extrabold text-primary-container">$</span>
              <input id="tx-amount" inputMode="decimal" value={form.amount} onChange={set('amount')} aria-invalid={Boolean(errors.amount)} className={`${input} !h-14 text-[24px] font-extrabold tracking-tight pl-10 pr-16`} />
              <span className="absolute right-4 text-[13px] font-bold text-on-surface-variant">USD</span>
            </div>{err('amount')}
          </div>
          <div>
            <label className={label} htmlFor="tx-name">{t('Magaca Qofka / Ganacsiga', 'Person / business name')}</label>
            <div className="relative flex items-center">
              <Icon name="person" className="absolute left-4 text-on-surface-variant text-[20px]" />
              <input id="tx-name" value={form.name} onChange={set('name')} placeholder={t('Ikhtiyaari', 'Optional')} className={`${input} text-[16px] font-semibold pl-12 pr-11`} />
              {form.name && <button type="button" aria-label={t('Tirtir magaca', 'Clear name')} onClick={() => { setDirty(true); setForm(f => ({ ...f!, name: '' })); }} className="absolute right-2 w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant active:bg-surface-container"><Icon name="close" className="text-[18px]" /></button>}
            </div>{err('counterpartyName')}
          </div>
          <div>
            <label className={label} htmlFor="tx-phone">{t('Lambarka Taleefanka', 'Phone number')}</label>
            <div className="relative flex items-center">
              <Icon name="call" className="absolute left-4 text-on-surface-variant text-[20px]" />
              <input id="tx-phone" type="tel" value={form.phone} onChange={set('phone')} placeholder={t('Ikhtiyaari', 'Optional')} className={`${input} text-[16px] font-semibold pl-12 pr-3`} />
            </div>{err('counterpartyPhone')}
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className={label} htmlFor="tx-date">{t('Taariikhda &amp; Waqtiga', 'Date & time')}</label>
              <input id="tx-date" type="datetime-local" step="1" value={form.occurredAt} onChange={set('occurredAt')} className={`${input} text-[15px] font-medium px-4`} />
              {err('occurredAt')}
            </div>
            <div>
              <label className={label} htmlFor="tx-balance">{t('Haraagii SMS-ka', 'Balance in the SMS')}</label>
              <div className="relative flex items-center">
                <span className="absolute left-4 text-[16px] font-bold text-on-surface-variant">$</span>
                <input id="tx-balance" inputMode="decimal" value={form.balance} onChange={set('balance')} placeholder="—" className={`${input} text-[16px] font-semibold pl-9 pr-3`} />
              </div>{err('balance')}
            </div>
          </div>
          {fallbackTime && <p className="text-[13px] leading-[1.38] text-on-surface-variant">{t('Fariintu waqti ma lahan. Haddii aad bannaan ka tagto, waqtiga taleefanku helay ayaa la isticmaali doonaa, waana la calaamadeyn doonaa:', 'The message has no time. If you leave it empty, the time the phone received it is used and marked:')} {fullDateTime(m.receivedAt, tz)}</p>}
        </form>
      </section>

      <section className="card overflow-hidden divide-y divide-outline-variant/40">
        <div className="px-4 py-3 flex items-center gap-3 text-on-surface-variant">
          <Icon name="cloud_sync" className="text-[18px] text-secondary shrink-0" />
          <p className="text-[13px] leading-[1.38]"><span className="font-semibold text-on-surface">{m.classificationSource === 'MANUAL' ? t('Gacanta ayaa lagu kala saaray', 'Classified by hand') : m.classification === 'PENDING' ? t('Weli lama kala saarin', 'Not classified yet') : t('Si toos ah ayaa loo kala saaray', 'Classified automatically')}</span> • {t('Waxaa toos loogu dirayaa aaladahaaga kale.', 'Sent straight to your other devices.')}</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-3 text-on-surface-variant">
          <Icon name="verified_user" className="text-[18px] text-primary shrink-0" />
          <p className="text-[13px] leading-[1.38]"><span className="font-semibold text-on-surface">SMS ID #{m.id.slice(0, 8).toUpperCase()}</span> • {t('Waxaa laga hortagay in mar labaad la diiwaangeliyo.', 'Protected against being recorded twice.')}</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-3 text-on-surface-variant">
          <Icon name="cloud_done" className="text-[18px] text-primary shrink-0" />
          <p className="text-[13px] leading-[1.38]"><span className="font-semibold text-on-surface">{t('La waafajiyay', 'Synced')}</span> • Server: {fullDateTime(m.uploadedAt, tz)} · {m.importMethod === 'INITIAL_IMPORT' ? t('Laga soo dejiyay fariimihii hore', 'Imported from older messages') : t('Fariin toos ah', 'Live message')}</p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)} className="w-full h-14 px-4 flex items-center justify-between text-[15.5px] font-bold text-on-surface active:bg-surface-container-low">
          <span>{t('Taariikhda isbeddelka', 'Change history')} ({detail.data!.history.length})</span><Icon name={showHistory ? 'expand_less' : 'expand_more'} /></button>
        {showHistory && <ol className="divide-y divide-outline-variant/40 border-t border-outline-variant/40">{detail.data!.history.map((h, i) => <li key={i} className="px-4 py-3 text-[13px] leading-[1.38]">
          <div className="flex justify-between gap-2"><span className="font-semibold text-on-surface">{actionText(h.action)} · v{h.toVersion}</span><span className="text-on-surface-variant">{fullDateTime(h.changedAt, tz)}</span></div>
          <p className="text-on-surface-variant mt-1">{h.actorDeviceName ?? 'Server'}{h.previous ? ` · ${t('Kahor', 'Before')}: ${classText(h.previous.classification)}${h.previous.amount ? ` ${money(h.previous.amount)}` : ''}${h.previous.counterpartyPhone ? ` ${masked(h.previous.counterpartyPhone)}` : ''}` : ''} → {classText(h.next.classification)}{h.next.amount ? ` ${money(h.next.amount)}` : ''}</p>
        </li>)}</ol>}
      </section>
    </div></main>
    <div className="fixed bottom-0 inset-x-0 z-50 bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/40 pb-safe">
      <div className="max-w-md mx-auto px-4 pt-3 flex gap-2">
        <button onClick={() => goBack('fariimaha')} aria-label={t('Jooji', 'Cancel')} className="h-[52px] w-[52px] shrink-0 rounded-2xl bg-surface-container text-on-surface flex items-center justify-center pressable"><Icon name="close" className="text-[22px]" /></button>
        <button disabled={saving || entry?.state === 'conflict'} onClick={save} className="flex-1 min-h-[52px] py-2 bg-primary-container text-on-primary rounded-2xl text-[16px] font-bold shadow-[0_6px_16px_-6px_rgba(10,107,63,0.55)] flex items-center justify-center gap-2 pressable disabled:opacity-55 leading-tight">
          <Icon name={saving ? 'progress_activity' : 'check'} className={`text-[20px] ${saving ? 'animate-spin' : ''}`} /><span>{saving ? t('Waa la keydinayaa…', 'Saving…') : t('Kaydi Dhaqdhaqaaqa', 'Save')}</span></button>
      </div>
    </div>
  </>;
}

/** Expense category of an outgoing EVC Plus payment (counts towards budgets and the category chart). */
function TxCategory({ messageId, value, onSaved }: { messageId: string; value: string | null; onSaved: () => void }) {
  const cats = useCategories();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = cats.get(value);
  async function save() {
    setBusy(true); setError(null);
    try { await api(`/messages/${messageId}/category`, { method: 'PUT', body: { category: pick } }); onSaved(); invalidateAll(); setOpen(false); }
    catch (e) { setError(offlineAware(e)); } finally { setBusy(false); }
  }
  return <>
    <button type="button" id="txCategoryBtn" onClick={() => { setPick(value); setOpen(true); }} className="card w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-surface-container-low">
      <CategoryIcon info={info} />
      <div className="flex-1 min-w-0"><div className="text-[12.5px] font-semibold text-on-surface-variant">{t('Qaybta qarashka', 'Expense category')}</div>
        <div className="text-[15.5px] font-bold text-on-surface break-words">{value ? info.label : t('Dooro qayb', 'Choose a category')}</div></div>
      <Icon name="chevron_right" className="text-on-surface-variant" /></button>
    {open && <Sheet open onClose={() => setOpen(false)} title={t('Qaybta qarashka', 'Expense category')}>
      <div className="overflow-y-auto max-h-[calc(60dvh/var(--app-zoom,1))] -mx-1 px-1"><CategoryGrid cats={cats} value={pick} onPick={setPick} allowNone /></div>
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <button type="button" disabled={busy} onClick={save} className="min-h-[52px] py-2 px-5 rounded-2xl text-[16px] font-bold flex items-center justify-center gap-2 pressable disabled:opacity-55 bg-primary-container text-on-primary leading-tight"><Icon name="check" className="text-[20px]" />{t('Kaydi', 'Save')}</button>
    </Sheet>}
  </>;
}
