import { useEffect, useState } from 'react';
import { localDate, parseAmount, toDecimalString } from '@toosh/shared';
import {
  CategoryEditor, CategoryGrid, CategoryIcon, Field, INPUT, LABEL, Progress, Segmented, cash, isZero, offlineAware, useCategories, type Categories,
} from '../components/finance.tsx';
import { PeriodChips, periodQuery } from '../components/PeriodPicker.tsx';
import { Banner, Button, EmptyState, EyeToggle, Group, Header, Icon, Main, SectionTitle, Sheet, Spinner, useAmounts } from '../components/ui.tsx';
import { api, qs, type ApiFailure } from '../lib/api.ts';
import { dayLabel } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { invalidateAll, useResource } from '../lib/sync.ts';
import type { Budget, Currency, Expense, Goal, PeriodChoice, SpendingItem, SpendingPage } from '../lib/types.ts';

type Tab = 'expenses' | 'budgets' | 'goals';

export function Qarash({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab === 'miisaaniyad' ? 'budgets' : initialTab === 'hadaf' ? 'goals' : 'expenses');
  const cats = useCategories();
  return <>
    <Header subtitle={t('Qarash', 'Expenses')} action={<EyeToggle className="text-on-surface-variant active:bg-surface-container-high" />} />
    <Main>
      <p className="px-1 -mt-1 text-[13.5px] font-semibold text-primary-container">{t('Maamul Qarashaadkaaga Si Fudud.', 'Manage your expenses with ease.')}</p>
      <Segmented label={t('Qaybta', 'Section')} value={tab} onChange={setTab}
        options={[['expenses', t('Qarashaad', 'Expenses')], ['budgets', t('Miisaaniyad', 'Budgets')], ['goals', t('Hadafyo', 'Goals')]]} />
      {tab === 'expenses' && <ExpensesTab cats={cats} />}
      {tab === 'budgets' && <BudgetsTab cats={cats} />}
      {tab === 'goals' && <GoalsTab />}
    </Main>
  </>;
}

// ---------------------------------------------------------------------------------------------------------------
// Expenses: EVC Plus payments and hand-entered expenses together.
// ---------------------------------------------------------------------------------------------------------------
interface Filters { category: string; source: 'all' | 'evc' | 'manual'; status: 'all' | 'paid' | 'unpaid'; currency: 'all' | Currency }
const NO_FILTERS: Filters = { category: '', source: 'all', status: 'all', currency: 'all' };

function ExpensesTab({ cats }: { cats: Categories }) {
  const { tz } = useSession();
  const { show } = useAmounts();
  const [period, setPeriod] = useState<PeriodChoice>({ period: 'month' });
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [evcItem, setEvcItem] = useState<SpendingItem | null>(null);
  const [more, setMore] = useState<SpendingItem[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  const params = {
    ...periodQuery(period), q: query, category: filters.category || null, source: filters.source === 'all' ? null : filters.source,
    status: filters.status === 'all' ? null : filters.status, currency: filters.currency === 'all' ? null : filters.currency,
  };
  const page = useResource<SpendingPage>(`spending:${JSON.stringify(params)}`, () => api(`/spending${qs({ ...params, limit: 30 })}`));
  useEffect(() => { setMore([]); setCursor(page.data?.nextCursor ?? null); }, [page.data]);
  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try { const r = await api<SpendingPage>(`/spending${qs({ ...params, limit: 30, cursor })}`); setMore(p => [...p, ...r.items]); setCursor(r.nextCursor); }
    catch (e) { setOpenError(offlineAware(e)); }
    finally { setLoadingMore(false); }
  }
  async function open(item: SpendingItem) {
    setOpenError(null);
    if (item.source === 'EVC') { setEvcItem(item); return; }
    try { setEditing((await api<{ expense: Expense }>(`/expenses/${item.id}`)).expense); } catch (e) { setOpenError(offlineAware(e)); }
  }

  const items = [...(page.data?.items ?? []), ...more];
  const groups: { key: string; label: string; items: SpendingItem[] }[] = [];
  const today = localDate(new Date(), tz); const yesterday = localDate(new Date(Date.now() - 864e5), tz);
  for (const it of items) {
    const label = it.spentOn === today ? t('Maanta', 'Today') : it.spentOn === yesterday ? t('Shalay', 'Yesterday') : dayLabel(`${it.spentOn}T12:00:00Z`, 'UTC').full;
    const g = groups[groups.length - 1];
    if (g?.key === it.spentOn) g.items.push(it); else groups.push({ key: it.spentOn, label, items: [it] });
  }
  const totals = page.data?.totals ?? {};
  const currencies = (['USD', 'SOS'] as const).filter(c => totals[c]);
  const activeFilters = Number(Boolean(filters.category)) + Number(filters.source !== 'all') + Number(filters.status !== 'all') + Number(filters.currency !== 'all');

  return <>
    <PeriodChips value={period} onChange={setPeriod} tz={tz} />
    <div className="relative flex items-center w-full">
      <Icon name="search" className="absolute left-4 text-on-surface-variant text-[22px] pointer-events-none" />
      <input value={q} onChange={e => setQ(e.target.value)} type="search" aria-label={t('Raadi qarash', 'Search expenses')} placeholder={t('Raadi magac ama faahfaahin', 'Search name or note')}
        className="w-full min-h-12 py-2 pl-12 pr-14 rounded-full bg-surface-container-lowest border border-outline-variant/60 text-on-surface text-[15px] placeholder:text-on-surface-variant/70 focus:outline-none focus:border-primary-container leading-tight" />
      <button aria-label={t('Shaandhee', 'Filter')} onClick={() => setFilterOpen(true)} className="absolute right-1.5 w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant active:bg-surface-container">
        <Icon name="tune" className="text-[20px]" />{activeFilters > 0 && <span className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-primary-container text-on-primary text-[10.5px] font-bold flex items-center justify-center">{activeFilters}</span>}</button>
    </div>

    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2"><Icon name="payments" className="text-primary-container text-[20px]" /><span className="text-[14px] font-bold text-on-surface flex-1">{t('Wadarta qarashka', 'Total spent')}</span>
        {page.loading && page.data && <Icon name="progress_activity" className="animate-spin text-[18px] text-on-surface-variant" />}</div>
      {!currencies.length && <span className="text-[24px] font-extrabold tracking-tight text-on-surface">{page.data ? show(cash('0', 'USD')) : '—'}</span>}
      {currencies.map(c => <div key={c} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span data-testid={`spent-${c}`} className="text-[clamp(20px,7cqw,26px)] leading-[1.25] font-extrabold tracking-tight text-on-surface break-all">{show(cash(totals[c]!.paid, c))}</span>
        <span className="text-[13px] text-on-surface-variant">{totals[c]!.count} {t('qarash', 'items')}</span>
        {!isZero(totals[c]!.unpaid) && <span className="w-full text-[13px] font-semibold text-tertiary-container">{t('Aan la bixin', 'Unpaid')}: {show(cash(totals[c]!.unpaid, c))}</span>}
      </div>)}
    </div>

    {openError && <Banner tone="error" icon="error">{openError}</Banner>}
    {page.error && !page.data && <Banner tone="error" icon="cloud_off">{offlineAware(page.error)}</Banner>}
    {!page.data && page.loading && <Spinner label={t('Qarashaadka waa la soo qaadayaa…', 'Loading expenses…')} />}
    {groups.map(g => <section key={g.key} className="flex flex-col gap-2">
      <h2 className="px-1 text-[15px] font-bold text-on-surface">{g.label}</h2>
      <Group>{g.items.map(it => <SpendRow key={`${it.source}:${it.id}`} item={it} cats={cats} onOpen={() => open(it)} />)}</Group>
    </section>)}
    {page.data && !items.length && <EmptyState icon="receipt_long" title={t('Qarash lama helin', 'No expenses found')}
      text={query || activeFilters ? t('Beddel raadinta ama shaandhaynta.', 'Change the search or filters.') : t('Ku dar qarashkaaga ugu horreeya, ama sug lacag EVC Plus ah oo baxda.', 'Add your first expense, or wait for an outgoing EVC Plus payment.')} />}
    {cursor && <Button kind="tonal" disabled={loadingMore} onClick={loadMore} className="self-center h-11 text-[14.5px]">{loadingMore ? t('Waa la soo qaadayaa…', 'Loading…') : t('Soo qaad kuwo hore', 'Load older')}</Button>}
    <button type="button" onClick={() => setManageOpen(true)} className="self-center min-h-10 px-4 rounded-full text-[14px] font-bold text-primary-container flex items-center gap-1.5 active:bg-surface-container-low">
      <Icon name="category" className="text-[19px]" />{t('Maamul qaybaha', 'Manage categories')}</button>
    <p className="text-[12px] leading-[1.42] text-on-surface-variant/90 text-center px-4 pb-16">{t('Lacagaha EVC Plus ee baxay iyo qarashaadka gacanta lagu daray ayaa halkan ku jira. USD iyo SOS lama isku darin.', 'Outgoing EVC Plus payments and expenses you add are listed here. USD and SOS are never added together.')}</p>

    <button type="button" id="addExpenseBtn" onClick={() => setEditing('new')}
      className="fixed z-40 right-4 bottom-[calc(max(env(safe-area-inset-bottom,0px),8px)+84px)] min-h-14 pl-4 pr-5 rounded-2xl bg-primary-container text-on-primary text-[15.5px] font-bold flex items-center gap-2 shadow-[0_10px_28px_-8px_rgba(10,107,63,0.7)] pressable leading-tight max-w-[calc(100%-2rem)]">
      <Icon name="add" className="text-[24px]" />{t('Ku dar qarash', 'Add expense')}</button>

    {editing && <ExpenseSheet cats={cats} expense={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    {evcItem && <EvcCategorySheet cats={cats} item={evcItem} onClose={() => setEvcItem(null)} />}
    {filterOpen && <FilterSheet cats={cats} value={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
    {manageOpen && <ManageCategories cats={cats} onClose={() => setManageOpen(false)} />}
  </>;
}

function SpendRow({ item, cats, onOpen }: { item: SpendingItem; cats: Categories; onOpen: () => void }) {
  const { show } = useAmounts();
  const info = cats.get(item.category);
  const unpaid = item.paymentStatus === 'UNPAID';
  return <button type="button" onClick={onOpen} className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 active:bg-surface-container-low transition-colors">
    <CategoryIcon info={info} />
    <div className="flex-1 min-w-[130px]">
      <div className="text-[15.5px] leading-[1.3] font-semibold text-on-surface line-clamp-2 break-words">{item.name}</div>
      <div className="text-[13px] leading-[1.38] text-on-surface-variant flex flex-wrap gap-x-1.5">
        <span className="whitespace-nowrap">{info.label}</span><span>·</span>
        <span className="whitespace-nowrap inline-flex items-center gap-0.5"><Icon name={item.source === 'EVC' ? 'sms' : 'edit_note'} className="text-[14px]" />{item.source === 'EVC' ? 'EVC Plus' : t('Gacan', 'Manual')}</span>
      </div>
      {unpaid && <span className="inline-flex items-center gap-1 mt-1 px-2 py-[3px] rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-[11.5px] leading-none font-semibold"><Icon name="schedule" className="text-[12px]" />{t('Lama bixin', 'Unpaid')}</span>}
    </div>
    <span className={`ml-auto pl-1 shrink-0 text-[16px] leading-[1.38] font-bold tracking-tight ${unpaid ? 'text-on-surface-variant' : 'text-on-surface'}`}>{show(cash(item.amount, item.currency, '-'))}</span>
  </button>;
}

function ExpenseSheet({ cats, expense, onClose }: { cats: Categories; expense: Expense | null; onClose: () => void }) {
  const { tz, prefs } = useSession();
  const today = localDate(new Date(), tz);
  const [form, setForm] = useState(() => ({
    name: expense?.name ?? '', amount: expense?.amount ?? '', currency: (expense?.currency ?? prefs.currency) as Currency, category: expense?.category ?? null as string | null,
    spentOn: expense?.spentOn ?? today, description: expense?.description ?? '', paymentStatus: expense?.paymentStatus ?? 'PAID' as 'PAID' | 'UNPAID',
  }));
  const [version, setVersion] = useState(expense?.version ?? 1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = t('Geli magaca qarashka.', 'Enter what the expense was for.');
    const a = parseAmount(form.amount.trim());
    if (!a.ok) errs.amount = t('Geli qaddar sax ah (sida 12.50).', 'Enter a valid amount (e.g. 12.50).');
    if (!form.category) errs.category = t('Dooro qaybta.', 'Choose a category.');
    if (!form.spentOn || form.spentOn > today) errs.spentOn = t('Taariikhdu ma noqon karto mustaqbalka.', 'The date cannot be in the future.');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { ...form, name: form.name.trim(), amount: form.amount.trim(), description: form.description.trim() || null };
    try {
      if (expense) await api(`/expenses/${expense.id}`, { method: 'PUT', body: { ...body, expectedVersion: version } });
      else await api('/expenses', { method: 'POST', body });
      invalidateAll(); onClose();
    } catch (err) {
      const f = err as ApiFailure;
      if (f.status === 409 && f.details?.current) {
        const c = f.details.current as Expense;
        setVersion(c.version);
        setForm({ name: c.name, amount: c.amount, currency: c.currency, category: c.category, spentOn: c.spentOn, description: c.description ?? '', paymentStatus: c.paymentStatus });
        setError(t('Aalad kale ayaa qarashkan beddeshay. Xogta cusub ayaa la soo galiyay — hubi kadibna kaydi mar kale.', 'Another device changed this expense. Its latest version is shown — check it and save again.'));
      } else { setError(offlineAware(err)); if (f.details) setErrors(f.details); }
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!expense) return;
    setBusy(true);
    try { await api(`/expenses/${expense.id}`, { method: 'DELETE' }); invalidateAll(); onClose(); }
    catch (err) { setError(offlineAware(err)); setConfirmDelete(false); } finally { setBusy(false); }
  }

  return <Sheet open onClose={onClose} title={expense ? t('Wax ka beddel qarashka', 'Edit expense') : t('Qarash cusub', 'New expense')}>
    <form onSubmit={save} noValidate className="flex flex-col gap-4 overflow-y-auto max-h-[calc(72dvh/var(--app-zoom,1))] -mx-1 px-1 pb-1">
      {error && <Banner tone="warn" icon="sync_problem">{error}</Banner>}
      <Field label={t('Magaca qarashka', 'Expense name')} error={errors.name}>
        <input id="expense-name" value={form.name} maxLength={120} onChange={e => set({ name: e.target.value })} placeholder={t('Tusaale: Biilka korontada', 'e.g. Electricity bill')} className={INPUT} /></Field>
      <div className="grid grid-cols-1 @min-[330px]:grid-cols-[1fr_auto] gap-3 items-start">
        <Field label={t('Qaddarka', 'Amount')} error={errors.amount}>
          <input id="expense-amount" inputMode="decimal" value={form.amount} onChange={e => set({ amount: e.target.value.replace(',', '.') })} placeholder="0.00" className={`${INPUT} text-[20px] font-bold`} /></Field>
        <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Lacagta', 'Currency')}</span>
          <Segmented label={t('Lacagta', 'Currency')} value={form.currency} onChange={v => set({ currency: v })} options={[['USD', 'USD $'], ['SOS', 'SOS']]} /></div>
      </div>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Qaybta', 'Category')}</span>
        <CategoryGrid cats={cats} value={form.category} onPick={ref => set({ category: ref })} />
        {errors.category && <span role="alert" className="px-1 text-[13px] text-error">{errors.category}</span>}</div>
      <Field label={t('Taariikhda', 'Date')} error={errors.spentOn}>
        <input type="date" value={form.spentOn} max={today} onChange={e => set({ spentOn: e.target.value })} className={INPUT} /></Field>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Xaaladda lacag bixinta', 'Payment status')}</span>
        <Segmented label={t('Xaaladda lacag bixinta', 'Payment status')} value={form.paymentStatus} onChange={v => set({ paymentStatus: v })}
          options={[['PAID', t('La bixiyay', 'Paid')], ['UNPAID', t('Lama bixin', 'Unpaid')]]} />
        {form.paymentStatus === 'UNPAID' && <span className="px-1 text-[12.5px] text-on-surface-variant">{t('Laguma darayo wadarta qarashka ilaa la bixiyo.', 'Not counted as spent until it is paid.')}</span>}</div>
      <Field label={t('Faahfaahin (ikhtiyaari)', 'Description (optional)')} error={errors.description}>
        <textarea value={form.description} maxLength={500} rows={2} onChange={e => set({ description: e.target.value })} className={`${INPUT} resize-none py-3`} /></Field>
      <Button id="saveExpenseBtn" disabled={busy} icon={busy ? 'progress_activity' : 'check'} spin={busy}>{t('Kaydi qarashka', 'Save expense')}</Button>
      {expense && !confirmDelete && <Button type="button" kind="ghost" icon="delete" className="!text-error" onClick={() => setConfirmDelete(true)}>{t('Tirtir qarashka', 'Delete expense')}</Button>}
      {expense && confirmDelete && <div className="rounded-2xl bg-error-container p-3 flex flex-col gap-2">
        <p className="text-[14px] text-on-error-container">{t('Ma hubtaa? Qarashku wuu ka bixi doonaa liisaska iyo wadarta.', 'Are you sure? The expense will be removed from lists and totals.')}</p>
        <div className="grid grid-cols-2 gap-2"><Button type="button" kind="tonal" onClick={() => setConfirmDelete(false)}>{t('Jooji', 'Cancel')}</Button>
          <Button type="button" kind="danger" className="!bg-error !text-on-error" disabled={busy} onClick={remove}>{t('Tirtir', 'Delete')}</Button></div>
      </div>}
    </form>
  </Sheet>;
}

function EvcCategorySheet({ cats, item, onClose }: { cats: Categories; item: SpendingItem; onClose: () => void }) {
  const { show } = useAmounts();
  const [value, setValue] = useState<string | null>(item.category);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    try { await api(`/messages/${item.id}/category`, { method: 'PUT', body: { category: value } }); invalidateAll(); onClose(); }
    catch (e) { setError(offlineAware(e)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={t('Qaybta lacag bixinta', 'Payment category')}>
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface-container-low">
      <div className="w-10 h-10 rounded-full bg-error-container text-on-error-container flex items-center justify-center shrink-0"><Icon name="north_east" className="text-[20px]" /></div>
      <div className="flex-1 min-w-0"><div className="text-[15px] font-semibold break-words">{item.name}</div><div className="text-[12.5px] text-on-surface-variant">EVC Plus · {item.spentOn}</div></div>
      <span className="text-[16px] font-bold shrink-0">{show(cash(item.amount, item.currency, '-'))}</span>
    </div>
    <CategoryGrid cats={cats} value={value} onPick={setValue} allowNone />
    {error && <Banner tone="error" icon="error">{error}</Banner>}
    <Button disabled={busy} onClick={save} icon="check">{t('Kaydi', 'Save')}</Button>
    <Button kind="ghost" icon="sms" onClick={() => { onClose(); navigate(`fariin/${item.id}`); }}>{t('Fur fariinta SMS', 'Open the SMS')}</Button>
  </Sheet>;
}

function FilterSheet({ cats, value, onChange, onClose }: { cats: Categories; value: Filters; onChange: (f: Filters) => void; onClose: () => void }) {
  const [f, setF] = useState(value);
  return <Sheet open onClose={onClose} title={t('Shaandhee', 'Filter')}>
    <div className="flex flex-col gap-4 overflow-y-auto max-h-[calc(70dvh/var(--app-zoom,1))] -mx-1 px-1">
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Meesha uu ka yimid', 'Source')}</span>
        <Segmented label={t('Meesha uu ka yimid', 'Source')} value={f.source} onChange={v => setF({ ...f, source: v })} options={[['all', t('Dhammaan', 'All')], ['evc', 'EVC Plus'], ['manual', t('Gacan', 'Manual')]]} /></div>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Xaaladda', 'Status')}</span>
        <Segmented label={t('Xaaladda', 'Status')} value={f.status} onChange={v => setF({ ...f, status: v })} options={[['all', t('Dhammaan', 'All')], ['paid', t('La bixiyay', 'Paid')], ['unpaid', t('Lama bixin', 'Unpaid')]]} /></div>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Lacagta', 'Currency')}</span>
        <Segmented label={t('Lacagta', 'Currency')} value={f.currency} onChange={v => setF({ ...f, currency: v })} options={[['all', t('Dhammaan', 'All')], ['USD', 'USD'], ['SOS', 'SOS']]} /></div>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Qaybta', 'Category')}</span>
        <div className="flex flex-wrap gap-2">
          {[{ ref: '', label: t('Dhammaan', 'All') }, ...cats.active.map(c => ({ ref: c.ref, label: c.label })), { ref: 'uncategorized', label: t('Qayb la’aan', 'Uncategorised') }].map(c =>
            <button key={c.ref || 'all'} type="button" aria-pressed={f.category === c.ref} onClick={() => setF({ ...f, category: c.ref })}
              className={`min-h-9 py-1 px-3.5 rounded-full text-[13.5px] font-semibold leading-tight ${f.category === c.ref ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface'}`}>{c.label}</button>)}
        </div></div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Button kind="tonal" onClick={() => { onChange(NO_FILTERS); onClose(); }}>{t('Nadiifi', 'Clear')}</Button>
      <Button onClick={() => { onChange(f); onClose(); }}>{t('Codso', 'Apply')}</Button></div>
  </Sheet>;
}

function ManageCategories({ cats, onClose }: { cats: Categories; onClose: () => void }) {
  const [editing, setEditing] = useState<{ id: string; name: string; icon: string } | 'new' | null>(null);
  const [archive, setArchive] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const custom = cats.custom.filter(c => !c.archived);
  async function doArchive(id: string) {
    setError(null);
    try { await api(`/categories/${id}`, { method: 'DELETE' }); cats.reload(); invalidateAll(); setArchive(null); } catch (e) { setError(offlineAware(e)); }
  }
  return <Sheet open onClose={onClose} title={t('Qaybaha qarashka', 'Expense categories')}>
    <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(70dvh/var(--app-zoom,1))] -mx-1 px-1">
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <span className={LABEL}>{t('Kuwaaga', 'Yours')}</span>
      {!custom.length && <p className="px-1 text-[13.5px] text-on-surface-variant">{t('Weli qayb gaar ah ma samaysan.', 'You have not added any categories yet.')}</p>}
      {custom.map(c => { const info = cats.get(c.ref); return <div key={c.id} className="flex items-center gap-3 p-2 pl-3 rounded-2xl bg-surface-container-low">
        <CategoryIcon size="sm" info={info} /><span className="flex-1 min-w-0 text-[15px] font-semibold break-words">{c.name}</span>
        <button aria-label={t('Wax ka beddel', 'Edit')} onClick={() => setEditing({ id: c.id, name: c.name, icon: c.icon })} className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant active:bg-surface-container"><Icon name="edit" className="text-[20px]" /></button>
        <button aria-label={t('Ka saar', 'Remove')} onClick={() => setArchive({ id: c.id, name: c.name })} className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant active:bg-error-container"><Icon name="delete" className="text-[20px]" /></button>
      </div>; })}
      <Button kind="tonal" icon="add" onClick={() => setEditing('new')}>{t('Ku dar qayb', 'Add category')}</Button>
      <span className={LABEL}>{t('Kuwa caadiga ah', 'Built-in')}</span>
      <div className="flex flex-wrap gap-2">{cats.active.filter(c => !c.ref.startsWith('custom:')).map(c => <span key={c.ref} className="inline-flex items-center gap-1.5 min-h-9 py-1 pl-1.5 pr-3 rounded-full bg-surface-container-low text-[13.5px] font-semibold leading-tight">
        <CategoryIcon size="sm" info={c} />{c.label}</span>)}</div>
    </div>
    {archive && <div className="rounded-2xl bg-error-container p-3 flex flex-col gap-2">
      <p className="text-[14px] text-on-error-container">{t(`Ka saar "${archive.name}"? Qarashaadkii hore way sii hayn doonaan, laakiin miisaaniyadda qaybtan waa la tirtiri doonaa.`, `Remove "${archive.name}"? Past expenses keep it, but its budgets are deleted.`)}</p>
      <div className="grid grid-cols-2 gap-2"><Button kind="tonal" onClick={() => setArchive(null)}>{t('Jooji', 'Cancel')}</Button>
        <Button kind="danger" className="!bg-error !text-on-error" onClick={() => doArchive(archive.id)}>{t('Ka saar', 'Remove')}</Button></div></div>}
    {editing && <CategoryEditor cats={cats} editing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
  </Sheet>;
}

// ---------------------------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------------------------
export const periodName = (p: Budget['period']) => p === 'DAILY' ? t('Maalinle', 'Daily') : p === 'WEEKLY' ? t('Toddobaadle', 'Weekly') : t('Bille', 'Monthly');

export function BudgetCard({ b, cats, onClick }: { b: Budget; cats: Categories; onClick?: () => void }) {
  const { show } = useAmounts();
  const info = b.category ? cats.get(b.category) : null;
  const tone = b.status === 'OVER' ? 'over' : b.status === 'WARNING' ? 'warn' : 'ok';
  const over = b.status === 'OVER';
  return <button type="button" onClick={onClick} disabled={!onClick} className="w-full text-left px-4 py-3.5 flex flex-col gap-2.5 active:bg-surface-container-low disabled:active:bg-transparent">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {info ? <CategoryIcon size="sm" info={info} /> : <div className="w-8 h-8 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant flex items-center justify-center shrink-0"><Icon name="account_balance_wallet" className="text-[17px]" /></div>}
      <div className="flex-1 min-w-[120px]"><div className="text-[15px] font-bold text-on-surface break-words">{info ? info.label : t('Dhammaan qarashaadka', 'All spending')}</div>
        <div className="text-[12.5px] text-on-surface-variant">{periodName(b.period)} · {b.currency}</div></div>
      <span className={`ml-auto shrink-0 inline-flex items-center gap-1 min-h-6 py-0.5 px-2.5 rounded-full text-[12px] font-bold leading-tight ${over ? 'bg-error-container text-on-error-container' : tone === 'warn' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-primary-fixed text-on-primary-fixed-variant'}`}>
        <Icon name={over ? 'error' : tone === 'warn' ? 'warning' : 'check_circle'} className="text-[14px]" />{over ? t('Waa la dhaafay', 'Over') : `${Math.round(b.percent)}%`}</span>
    </div>
    <Progress percent={b.percent} tone={tone} />
    <div className="flex flex-wrap justify-between gap-x-3 text-[13px]">
      <span className="text-on-surface"><strong>{show(cash(b.spent, b.currency))}</strong> <span className="text-on-surface-variant">/ {show(cash(b.amount, b.currency))}</span></span>
      <span className={over ? 'text-error font-semibold' : 'text-on-surface-variant'}>{over ? `${t('Ka badan', 'Over by')} ${show(cash(b.remaining.replace('-', ''), b.currency))}` : `${show(cash(b.remaining, b.currency))} ${t('ayaa haray', 'left')}`}</span>
    </div>
  </button>;
}

/** Banner for budgets near or over their limit. */
export function BudgetAlerts({ budgets, cats }: { budgets: Budget[]; cats: Categories }) {
  const { prefs } = useSession();
  const { show } = useAmounts();
  if (!prefs.budgetAlerts) return null;
  const hot = budgets.filter(b => b.status !== 'OK');
  if (!hot.length) return null;
  return <div className="flex flex-col gap-2">{hot.map(b => {
    const name = b.category ? cats.get(b.category).label : t('Dhammaan qarashaadka', 'All spending');
    return <Banner key={b.id} tone={b.status === 'OVER' ? 'error' : 'warn'} icon={b.status === 'OVER' ? 'error' : 'warning'}>
      {b.status === 'OVER'
        ? t(`Miisaaniyadda ${periodName(b.period).toLowerCase()} ee "${name}" waa la dhaafay: ${show(cash(b.spent, b.currency))} / ${show(cash(b.amount, b.currency))}.`, `${periodName(b.period)} budget "${name}" is over: ${show(cash(b.spent, b.currency))} of ${show(cash(b.amount, b.currency))}.`)
        : t(`Miisaaniyadda "${name}" waxaa la isticmaalay ${Math.round(b.percent)}%.`, `${Math.round(b.percent)}% of the "${name}" budget is used.`)}
    </Banner>;
  })}</div>;
}

function BudgetsTab({ cats }: { cats: Categories }) {
  const res = useResource<{ budgets: Budget[] }>('budgets', () => api('/budgets'));
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const budgets = res.data?.budgets ?? [];
  return <>
    <BudgetAlerts budgets={budgets} cats={cats} />
    {res.error && !res.data && <Banner tone="error" icon="cloud_off">{offlineAware(res.error)}</Banner>}
    {!res.data && res.loading && <Spinner label={t('Miisaaniyadda waa la soo qaadayaa…', 'Loading budgets…')} />}
    {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map(p => {
      const list = budgets.filter(b => b.period === p);
      if (!list.length) return null;
      return <section key={p} className="flex flex-col gap-2"><SectionTitle>{periodName(p)}</SectionTitle>
        <Group>{list.map(b => <BudgetCard key={b.id} b={b} cats={cats} onClick={() => setEditing(b)} />)}</Group></section>;
    })}
    {res.data && !budgets.length && <EmptyState icon="savings" title={t('Weli miisaaniyad ma jirto', 'No budgets yet')}
      text={t('Xadid inta aad ku bixinayso maalin, toddobaad ama bil — dhammaan ama qayb kasta. Waxaad helaysaa digniin markaad u dhowaato xadka.', 'Set how much you spend per day, week or month — overall or per category. You get a warning as you near the limit.')} />}
    <Button id="addBudgetBtn" icon="add" onClick={() => setEditing('new')}>{t('Ku dar miisaaniyad', 'Add budget')}</Button>
    {editing && <BudgetSheet cats={cats} budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={res.reload} />}
  </>;
}

function BudgetSheet({ cats, budget, onClose, onSaved }: { cats: Categories; budget: Budget | null; onClose: () => void; onSaved: () => void }) {
  const { prefs } = useSession();
  const [period, setPeriod] = useState<Budget['period']>(budget?.period ?? 'MONTHLY');
  const [category, setCategory] = useState<string | null>(budget?.category ?? null);
  const [amount, setAmount] = useState(budget?.amount ?? '');
  const [currency, setCurrency] = useState<Currency>(budget?.currency ?? prefs.currency);
  const [alert, setAlert] = useState(budget?.alertPercent ?? 80);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!parseAmount(amount.trim()).ok) { setError(t('Geli xad sax ah (sida 100).', 'Enter a valid limit (e.g. 100).')); return; }
    setBusy(true);
    try {
      const r = await api<{ budget: Budget }>('/budgets', { method: 'PUT', body: { period, category, amount: amount.trim(), currency, alertPercent: alert } });
      // Changing the period, category or currency makes a different budget; remove the one being edited.
      if (budget && r.budget.id !== budget.id) await api(`/budgets/${budget.id}`, { method: 'DELETE' });
      onSaved(); invalidateAll(); onClose();
    } catch (err) { setError(offlineAware(err)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!budget) return;
    setBusy(true);
    try { await api(`/budgets/${budget.id}`, { method: 'DELETE' }); onSaved(); invalidateAll(); onClose(); } catch (err) { setError(offlineAware(err)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={budget ? t('Wax ka beddel miisaaniyadda', 'Edit budget') : t('Miisaaniyad cusub', 'New budget')}>
    <form onSubmit={save} noValidate className="flex flex-col gap-4 overflow-y-auto max-h-[calc(72dvh/var(--app-zoom,1))] -mx-1 px-1 pb-1">
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Muddada', 'Period')}</span>
        <Segmented label={t('Muddada', 'Period')} value={period} onChange={setPeriod} options={[['DAILY', t('Maalin', 'Day')], ['WEEKLY', t('Toddobaad', 'Week')], ['MONTHLY', t('Bil', 'Month')]]} /></div>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Qaybta (dooro "Midna" si loo xadido dhammaan)', 'Category (choose "None" to cover all spending)')}</span>
        <CategoryGrid cats={cats} value={category} onPick={setCategory} allowNone /></div>
      <div className="grid grid-cols-1 @min-[330px]:grid-cols-[1fr_auto] gap-3 items-start">
        <Field label={t('Xadka', 'Limit')}><input id="budget-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(',', '.'))} placeholder="0.00" className={`${INPUT} text-[20px] font-bold`} /></Field>
        <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Lacagta', 'Currency')}</span>
          <Segmented label={t('Lacagta', 'Currency')} value={currency} onChange={setCurrency} options={[['USD', 'USD $'], ['SOS', 'SOS']]} /></div>
      </div>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Digniin marka la gaaro', 'Warn me at')}</span>
        <div className="flex flex-wrap gap-2">{[50, 70, 80, 90, 100].map(p => <button key={p} type="button" aria-pressed={alert === p} onClick={() => setAlert(p)}
          className={`min-h-10 px-4 rounded-full text-[14px] font-bold leading-tight ${alert === p ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface'}`}>{p}%</button>)}</div></div>
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <Button id="saveBudgetBtn" disabled={busy} icon="check">{t('Kaydi miisaaniyadda', 'Save budget')}</Button>
      {budget && <Button type="button" kind="ghost" icon="delete" className="!text-error" disabled={busy} onClick={remove}>{t('Tirtir miisaaniyadda', 'Delete budget')}</Button>}
    </form>
  </Sheet>;
}

// ---------------------------------------------------------------------------------------------------------------
// Savings goals
// ---------------------------------------------------------------------------------------------------------------
const addDecimal = (a: string, b: string) => {
  const x = parseAmount(a, { allowZero: true }); const y = parseAmount(b, { allowZero: true });
  return x.ok && y.ok ? toDecimalString(x.milli + y.milli) : null;
};
const percentOf = (saved: string, target: string) => {
  const s = parseAmount(saved, { allowZero: true }); const g = parseAmount(target);
  return s.ok && g.ok ? Number((s.milli * 1000n) / g.milli) / 10 : 0;
};

function GoalsTab() {
  const { show } = useAmounts();
  const res = useResource<{ goals: Goal[] }>('goals', () => api('/goals'));
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [adding, setAdding] = useState<Goal | null>(null);
  const goals = res.data?.goals ?? [];
  return <>
    {res.error && !res.data && <Banner tone="error" icon="cloud_off">{offlineAware(res.error)}</Banner>}
    {!res.data && res.loading && <Spinner label={t('Hadafyada waa la soo qaadayaa…', 'Loading goals…')} />}
    {goals.length > 0 && <Group>{goals.map(g => {
      const pct = percentOf(g.saved, g.target);
      const done = pct >= 100;
      return <div key={g.id} className="px-4 py-3.5 flex flex-col gap-2.5">
        <button type="button" onClick={() => setEditing(g)} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-primary-container text-on-primary' : 'bg-secondary-fixed text-on-secondary-fixed-variant'}`}><Icon name={done ? 'emoji_events' : 'savings'} className="text-[20px]" /></div>
          <div className="flex-1 min-w-[120px]"><div className="text-[15.5px] font-bold text-on-surface break-words">{g.name}</div>
            <div className="text-[12.5px] text-on-surface-variant">{g.targetDate ? `${t('Ilaa', 'By')} ${g.targetDate}` : g.currency}</div></div>
          <span className="ml-auto text-[14px] font-bold text-primary-container shrink-0">{Math.min(100, Math.round(pct))}%</span>
        </button>
        <Progress percent={pct} tone="ok" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px]"><strong>{show(cash(g.saved, g.currency))}</strong> <span className="text-on-surface-variant">/ {show(cash(g.target, g.currency))}</span></span>
          <button type="button" onClick={() => setAdding(g)} className="min-h-9 py-1 px-3.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[13px] font-bold flex items-center gap-1 pressable leading-tight"><Icon name="add" className="text-[17px]" />{t('Ku dar lacag', 'Add money')}</button>
        </div>
      </div>;
    })}</Group>}
    {res.data && !goals.length && <EmptyState icon="savings" title={t('Weli hadaf ma jiro', 'No savings goals yet')} text={t('Samee hadaf kayd (tusaale: Gaari, Waxbarasho) oo la soco inta aad keydisay.', 'Create a savings goal (e.g. a car, school fees) and track how much you have saved.')} />}
    <Button id="addGoalBtn" icon="add" onClick={() => setEditing('new')}>{t('Ku dar hadaf', 'Add goal')}</Button>
    {editing && <GoalSheet goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={res.reload} />}
    {adding && <AddToGoal goal={adding} onClose={() => setAdding(null)} onSaved={res.reload} />}
  </>;
}

function GoalSheet({ goal, onClose, onSaved }: { goal: Goal | null; onClose: () => void; onSaved: () => void }) {
  const { prefs } = useSession();
  const [f, setF] = useState({ name: goal?.name ?? '', target: goal?.target ?? '', saved: goal?.saved ?? '', currency: goal?.currency ?? prefs.currency, targetDate: goal?.targetDate ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = t('Geli magaca hadafka.', 'Enter a goal name.');
    if (!parseAmount(f.target.trim()).ok) errs.target = t('Geli qaddar sax ah.', 'Enter a valid amount.');
    if (f.saved.trim() && !parseAmount(f.saved.trim(), { allowZero: true }).ok) errs.saved = t('Geli qaddar sax ah.', 'Enter a valid amount.');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = { name: f.name.trim(), target: f.target.trim(), saved: f.saved.trim() || '0', currency: f.currency, targetDate: f.targetDate || null };
    try {
      if (goal) await api(`/goals/${goal.id}`, { method: 'PUT', body }); else await api('/goals', { method: 'POST', body });
      onSaved(); onClose();
    } catch (err) { setError(offlineAware(err)); if ((err as ApiFailure).details) setErrors((err as ApiFailure).details); } finally { setBusy(false); }
  }
  async function remove() {
    if (!goal) return;
    setBusy(true);
    try { await api(`/goals/${goal.id}`, { method: 'DELETE' }); onSaved(); onClose(); } catch (err) { setError(offlineAware(err)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={goal ? t('Wax ka beddel hadafka', 'Edit goal') : t('Hadaf cusub', 'New goal')}>
    <form onSubmit={save} noValidate className="flex flex-col gap-4 overflow-y-auto max-h-[calc(72dvh/var(--app-zoom,1))] -mx-1 px-1 pb-1">
      <Field label={t('Magaca hadafka', 'Goal name')} error={errors.name}><input id="goal-name" value={f.name} maxLength={80} onChange={e => setF({ ...f, name: e.target.value })} placeholder={t('Tusaale: Gaari', 'e.g. Car')} className={INPUT} /></Field>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Lacagta', 'Currency')}</span>
        <Segmented label={t('Lacagta', 'Currency')} value={f.currency} onChange={v => setF({ ...f, currency: v })} options={[['USD', 'USD $'], ['SOS', 'SOS']]} /></div>
      <div className="grid grid-cols-1 @min-[330px]:grid-cols-2 gap-3">
        <Field label={t('Hadafka', 'Target')} error={errors.target}><input id="goal-target" inputMode="decimal" value={f.target} onChange={e => setF({ ...f, target: e.target.value.replace(',', '.') })} placeholder="0.00" className={INPUT} /></Field>
        <Field label={t('La keydiyay', 'Saved so far')} error={errors.saved}><input inputMode="decimal" value={f.saved} onChange={e => setF({ ...f, saved: e.target.value.replace(',', '.') })} placeholder="0.00" className={INPUT} /></Field>
      </div>
      <Field label={t('Taariikhda la rabo (ikhtiyaari)', 'Target date (optional)')}><input type="date" value={f.targetDate} onChange={e => setF({ ...f, targetDate: e.target.value })} className={INPUT} /></Field>
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <Button id="saveGoalBtn" disabled={busy} icon="check">{t('Kaydi hadafka', 'Save goal')}</Button>
      {goal && <Button type="button" kind="ghost" icon="delete" className="!text-error" disabled={busy} onClick={remove}>{t('Tirtir hadafka', 'Delete goal')}</Button>}
    </form>
  </Sheet>;
}

function AddToGoal({ goal, onClose, onSaved }: { goal: Goal; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const saved = parseAmount(amount.trim()).ok ? addDecimal(goal.saved, amount.trim()) : null;
    if (!saved) { setError(t('Geli qaddar sax ah.', 'Enter a valid amount.')); return; }
    setBusy(true);
    try { await api(`/goals/${goal.id}`, { method: 'PUT', body: { name: goal.name, target: goal.target, saved, currency: goal.currency, targetDate: goal.targetDate } }); onSaved(); onClose(); }
    catch (err) { setError(offlineAware(err)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={`${t('Ku dar', 'Add to')} ${goal.name}`}>
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field label={`${t('Qaddarka', 'Amount')} (${goal.currency})`}><input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(',', '.'))} placeholder="0.00" className={`${INPUT} text-[20px] font-bold`} /></Field>
      {error && <Banner tone="error" icon="error">{error}</Banner>}
      <Button disabled={busy} icon="savings">{t('Ku dar', 'Add')}</Button>
    </form>
  </Sheet>;
}
