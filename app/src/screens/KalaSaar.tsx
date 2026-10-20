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
      <main className="max-w-md mx-auto px-margin pt-20">{detail.error ? <Banner tone="error" icon="error">{detail.error.message}</Banner> : <Spinner label="Fariinta waa la soo qaadayaa…" />}</main></>;
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
      className={`w-full text-left rounded-xl p-3.5 transition-all flex items-center justify-between ${active ? 'bg-primary-container text-on-primary shadow-md' : 'bg-surface-container-lowest shadow-sm'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-primary text-on-primary-container' : iconCls}`}><Icon name={icon} className="text-[20px]" /></div>
        <div>
          <div className={`font-title-md text-title-md flex items-center gap-1.5 ${active ? 'text-on-primary' : 'text-on-surface'}`}><span>{title}</span>{en && <span className={`font-body-sm text-body-sm ${active ? 'text-on-primary-container font-medium' : 'text-on-surface-variant'}`}>{en}</span>}</div>
          <p className={`font-body-sm text-body-sm ${active ? 'text-on-primary-container' : 'text-on-surface-variant'}`}>{sub}</p>
        </div>
      </div>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${active ? 'bg-on-primary' : 'bg-surface-container'}`}><div className={`rounded-full ${active ? 'w-2.5 h-2.5 bg-primary-container' : 'w-2 h-2 bg-transparent'}`} /></div>
    </button>;
  };
  const label = 'block font-label-ui text-label-ui uppercase tracking-wider text-on-surface-variant mb-1';
  const input = 'w-full bg-surface-container-low text-on-surface rounded-lg focus:outline-none focus:bg-surface-container-high transition-colors';
  const err = (k: string) => errors[k] ? <p role="alert" className="font-body-sm text-body-sm text-error mt-1">{errors[k]}</p> : null;
  const fallbackTime = !m.parsed.occurredAt && !form.occurredAt;

  return <>
    <Header title="Faahfaahinta Dhaqdhaqaaqa" back={() => goBack('fariimaha')} />
    <main className="flex-1 w-full max-w-md mx-auto px-margin pt-20 pb-safe bg-surface"><div className="flex flex-col w-full pb-8">
      <div className="flex items-center justify-between bg-surface-container-high rounded-xl px-4 py-2.5 mb-4 shadow-sm">
        <div className="flex items-center gap-2">
          {m.classification === 'PENDING' && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary-container opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" /></span>}
          <span className="font-title-md text-title-md text-on-surface">{m.classification === 'PENDING' ? 'Fariin Cusub' : 'Fariin'}</span><OutboxBadge entry={entry} />
        </div>
        <span className="bg-surface-container-highest text-on-surface-variant font-label-ui text-label-ui px-2.5 py-1 rounded-full uppercase tracking-wider">
          {m.classification === 'PENDING' ? 'Ma cadda (Sugaya)' : m.classification === 'TRANSACTION' ? (m.transaction!.direction === 'IN' ? 'Soo galay' : 'Baxay') : 'Ma aha transaction'}</span>
      </div>

      {entry?.state === 'conflict' && entry.current && <section className="mb-4 rounded-xl border border-tertiary-container bg-tertiary-fixed p-3 flex flex-col gap-2" aria-label="Isku dhac">
        <div className="flex items-center gap-2 text-on-tertiary-fixed"><Icon name="warning" /><h2 className="font-title-md text-title-md">Aalad kale ayaa beddeshay fariintan</h2></div>
        <p className="font-body-sm text-body-sm text-on-tertiary-fixed-variant">Kaydka hadda jira: <strong>{CLASS_TEXT[entry.current.classification]}{entry.current.transaction ? ` · ${entry.current.transaction.direction === 'IN' ? 'Soo galay' : 'Baxay'} ${money(entry.current.transaction.amount)}` : ''}</strong>. Isbeddelkaaga: <strong>{entry.request.classification === 'NOT_TRANSACTION' ? 'Ma aha transaction' : `${entry.request.direction === 'IN' ? 'Soo galay' : 'Baxay'} ${money(String(entry.request.amount))}`}</strong>.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={keepTheirs} className="h-11 rounded-lg bg-surface-container-lowest text-on-surface font-title-md text-body-md">Hayso kooda</button>
          <button onClick={() => overwriteWithMine(id, () => { setDirty(false); detail.reload(); if (onThisScreen()) goBack('fariimaha'); })} className="h-11 rounded-lg bg-tertiary-container text-on-tertiary font-title-md text-body-md">Kaydi kayga</button>
        </div>
      </section>}
      {changedElsewhere && <div className="mb-4"><Banner tone="warn" icon="sync_problem">Fariintan waa la beddelay inta aad furnayd. <button className="underline font-semibold" onClick={reloadLatest}>Soo qaad tan cusub</button> ama kaydi si aad u aragto isku dhaca.</Banner></div>}
      {entry?.state === 'failed' && <div className="mb-4"><Banner tone="error" icon="error">{entry.error}</Banner></div>}
      {notice && <div className="mb-4"><Banner tone="info" icon="cloud_queue">{notice}</Banner></div>}

      <section className="bg-surface-container-lowest rounded-xl p-4 shadow-sm mb-5 relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5"><Icon name="sms" className="text-[18px] text-primary" /><h2 className="font-label-ui text-label-ui text-on-surface-variant tracking-wider uppercase">Fariinta Asalka ah ee SMS-ka</h2></div>
          {m.simSlot !== null && <span className="font-label-numeric-sm text-label-numeric-sm text-secondary bg-surface-container px-2 py-0.5 rounded-full">SIM {m.simSlot + 1}</span>}
        </div>
        <div data-testid="original-sms" className="bg-surface-container-low rounded-lg p-3 font-label-numeric-sm text-label-numeric-sm text-on-surface leading-relaxed select-all whitespace-pre-wrap break-words">{m.body}</div>
        <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">Diraha: {m.sender} · La helay: {fullDateTime(m.receivedAt, tz)}{m.partsCount > 1 ? ` · ${m.partsCount} qaybood` : ''}</p>
        {issues.length > 0 && <div className="mt-2.5 flex items-start gap-2 bg-tertiary-fixed text-on-tertiary-fixed rounded-lg p-2.5">
          <Icon name="warning" className="text-[18px] shrink-0 text-tertiary mt-0.5" />
          <ul className="font-body-sm text-body-sm text-tertiary leading-tight list-none space-y-1">{issues.map(i => <li key={i}>{ISSUE_TEXT[i]}</li>)}</ul>
        </div>}
      </section>

      <section className="mb-5">
        <h3 className="font-title-md text-title-md text-on-surface mb-3 flex items-center justify-between"><span>Dooro Nooca Dhaqdhaqaaqa</span><span className="font-body-sm text-body-sm text-on-surface-variant">Tallaabada 1aad</span></h3>
        <div className="grid grid-cols-1 gap-2.5" role="radiogroup" aria-label="Nooca dhaqdhaqaaqa">
          {typeCard('incoming', 'arrow_downward', 'Soo galay', '(Incoming)', 'Lacag qof kale kaa soo gaartay', 'bg-primary-fixed text-primary')}
          {typeCard('outgoing', 'arrow_upward', 'Baxay', '(Outgoing)', 'Lacag aad adigu dirtay ama wax ku iibsatay', 'bg-error-container text-on-error-container')}
          {typeCard('ignored', 'block', 'Ma aha transaction', '', 'Xayeysiis, digniin, ama fariin bangi kale', 'bg-surface-container-highest text-on-surface-variant')}
        </div>
        {err('direction')}
      </section>

      <section className={`bg-surface-container-lowest rounded-xl p-4 shadow-sm mb-5 transition-opacity duration-200 ${form.choice === 'ignored' ? 'opacity-40 pointer-events-none' : ''}`} aria-disabled={form.choice === 'ignored'}>
        <div className="flex items-center justify-between mb-3.5"><h3 className="font-title-md text-title-md text-on-surface">Faahfaahinta Dhaqdhaqaaqa</h3><span className="font-body-sm text-body-sm text-on-surface-variant">La saxo karo</span></div>
        <form className="space-y-3.5" onSubmit={e => { e.preventDefault(); save(); }}>
          <div>
            <label className={label} htmlFor="tx-amount">Qaddarka Lacagta (Amount)</label>
            <div className="relative flex items-center">
              <span className="absolute left-3 font-label-numeric-lg text-label-numeric-lg text-primary">$</span>
              <input id="tx-amount" inputMode="decimal" value={form.amount} onChange={set('amount')} aria-invalid={Boolean(errors.amount)} className={`${input} font-label-numeric-lg text-label-numeric-lg pl-8 pr-14 py-2.5`} />
              <span className="absolute right-3 font-label-ui text-label-ui text-on-surface-variant uppercase">USD</span>
            </div>{err('amount')}
          </div>
          <div>
            <label className={label} htmlFor="tx-name">Magaca Qofka / Ganacsiga</label>
            <div className="relative flex items-center">
              <Icon name="person" className="absolute left-3 text-on-surface-variant text-[20px]" />
              <input id="tx-name" value={form.name} onChange={set('name')} placeholder="Ikhtiyaari" className={`${input} font-title-md text-title-md pl-10 pr-10 py-2.5`} />
              {form.name && <button type="button" aria-label="Tirtir magaca" onClick={() => { setDirty(true); setForm(f => ({ ...f!, name: '' })); }} className="absolute right-2.5 text-on-surface-variant hover:text-on-surface p-1"><Icon name="close" className="text-[18px]" /></button>}
            </div>{err('counterpartyName')}
          </div>
          <div>
            <label className={label} htmlFor="tx-phone">Lambarka Taleefanka</label>
            <div className="relative flex items-center">
              <Icon name="call" className="absolute left-3 text-on-surface-variant text-[20px]" />
              <input id="tx-phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="Ikhtiyaari" className={`${input} font-label-numeric-md text-label-numeric-md pl-10 pr-3 py-2.5`} />
            </div>{err('counterpartyPhone')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="tx-date">Taariikhda &amp; Waqtiga</label>
              <input id="tx-date" type="datetime-local" step="1" value={form.occurredAt} onChange={set('occurredAt')} className={`${input} font-body-sm text-body-sm px-3 py-2.5`} />
              {err('occurredAt')}
            </div>
            <div>
              <label className={label} htmlFor="tx-balance">Haraagii SMS-ka</label>
              <div className="relative flex items-center">
                <span className="absolute left-3 font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">$</span>
                <input id="tx-balance" inputMode="decimal" value={form.balance} onChange={set('balance')} placeholder="—" className={`${input} font-label-numeric-md text-label-numeric-md pl-7 pr-3 py-2.5`} />
              </div>{err('balance')}
            </div>
          </div>
          {fallbackTime && <p className="font-body-sm text-body-sm text-on-surface-variant">Fariintu waqti ma lahan. Haddii aad bannaan ka tagto, waqtiga taleefanku helay ({fullDateTime(m.receivedAt, tz)}) ayaa la isticmaali doonaa, waana la calaamadeyn doonaa.</p>}
        </form>
      </section>

      <section className="space-y-2 mb-6">
        <div className="bg-surface-container-low rounded-lg p-2.5 flex items-center gap-2.5 text-on-surface-variant">
          <Icon name="cloud_sync" className="text-[18px] text-secondary shrink-0" />
          <p className="font-body-sm text-body-sm leading-tight"><span className="font-medium text-on-surface">{m.classificationSource === 'MANUAL' ? 'Gacanta ayaa lagu kala saaray' : m.classification === 'PENDING' ? 'Weli lama kala saarin' : 'Si toos ah ayaa loo kala saaray'}</span> • Waxaa toos loogu dirayaa aaladahaaga kale.</p>
        </div>
        <div className="bg-surface-container-low rounded-lg p-2.5 flex items-center gap-2.5 text-on-surface-variant">
          <Icon name="verified_user" className="text-[18px] text-primary shrink-0" />
          <p className="font-body-sm text-body-sm leading-tight"><span className="font-medium text-on-surface">SMS ID #{m.id.slice(0, 8).toUpperCase()}</span> • Waxaa laga hortagay in mar labaad la diiwaangeliyo.</p>
        </div>
        <div className="bg-surface-container-low rounded-lg p-2.5 flex items-center gap-2.5 text-on-surface-variant">
          <Icon name="cloud_done" className="text-[18px] text-primary shrink-0" />
          <p className="font-body-sm text-body-sm leading-tight"><span className="font-medium text-on-surface">La waafajiyay</span> • Server-ka: {fullDateTime(m.uploadedAt, tz)} · {m.importMethod === 'INITIAL_IMPORT' ? 'Laga soo dejiyay fariimihii hore' : 'Fariin toos ah'}</p>
        </div>
      </section>

      <div className="flex flex-col gap-2.5 pt-2">
        <button disabled={saving || entry?.state === 'conflict'} onClick={save} className="w-full h-12 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-title-md text-title-md shadow-md flex items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-60">
          <Icon name={saving ? 'sync' : 'check'} className={`text-[20px] ${saving ? 'animate-spin' : ''}`} /><span>{saving ? 'Waa la keydinayaa…' : 'Kaydi Dhaqdhaqaaqa'}</span></button>
        <button onClick={() => goBack('fariimaha')} className="w-full h-12 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-lg font-title-md text-title-md flex items-center justify-center gap-2"><Icon name="close" className="text-[20px]" /><span>Jooji</span></button>
      </div>

      <section className="mt-6">
        <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)} className="w-full flex items-center justify-between font-title-md text-title-md text-on-surface">
          <span>Taariikhda isbeddelka ({detail.data!.history.length})</span><Icon name={showHistory ? 'expand_less' : 'expand_more'} /></button>
        {showHistory && <ol className="mt-3 space-y-2">{detail.data!.history.map((h, i) => <li key={i} className="bg-surface-container-lowest rounded-xl p-3 shadow-sm font-body-sm text-body-sm">
          <div className="flex justify-between gap-2"><span className="font-semibold text-on-surface">{ACTION_TEXT[h.action]} · v{h.toVersion}</span><span className="text-on-surface-variant">{fullDateTime(h.changedAt, tz)}</span></div>
          <p className="text-on-surface-variant mt-1">{h.actorDeviceName ?? 'Server'}{h.previous ? ` · Kahor: ${CLASS_TEXT[h.previous.classification]}${h.previous.amount ? ` ${money(h.previous.amount)}` : ''}${h.previous.counterpartyPhone ? ` ${masked(h.previous.counterpartyPhone)}` : ''}` : ''} → {CLASS_TEXT[h.next.classification]}{h.next.amount ? ` ${money(h.next.amount)}` : ''}</p>
        </li>)}</ol>}
      </section>
    </div></main>
  </>;
}
