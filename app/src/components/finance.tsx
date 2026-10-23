import { useState } from 'react';
import { formatCurrency, parseAmount } from '@toosh/shared';
import { api } from '../lib/api.ts';
import { getLanguage, t } from '../lib/i18n.ts';
import { useResource } from '../lib/sync.ts';
import type { CategoryList, Currency } from '../lib/types.ts';
import { Button, Icon, Sheet } from './ui.tsx';

/** "$12.50" / "SOS 12,500" from a canonical decimal string. */
export function cash(value: string | null | undefined, currency: Currency, sign: '' | '+' | '-' = ''): string {
  if (value === null || value === undefined) return '—';
  const r = parseAmount(value.replace(/^-/, ''), { allowZero: true });
  if (!r.ok) return '—';
  const neg = value.startsWith('-');
  return formatCurrency(neg ? -r.milli : r.milli, currency, sign);
}
export const isZero = (v: string | null | undefined) => !v || /^-?0+(\.0+)?$/.test(v);

/** Soft colour pairs for category icons, picked by position so neighbours differ. */
const TONES = [
  'bg-primary-fixed text-on-primary-fixed-variant', 'bg-secondary-fixed text-on-secondary-fixed-variant', 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  'bg-error-container text-on-error-container', 'bg-surface-container-high text-on-surface',
];
const BAR = ['bg-primary-container', 'bg-secondary', 'bg-tertiary-container', 'bg-error', 'bg-outline'];

export interface CategoryInfo { ref: string; label: string; icon: string; tone: string; bar: string; archived: boolean }
const UNCATEGORIZED = (): CategoryInfo => ({ ref: 'uncategorized', label: t('Qayb la’aan', 'Uncategorised'), icon: 'help', tone: 'bg-surface-container text-on-surface-variant', bar: 'bg-outline-variant', archived: false });

/** Built-in and custom categories, with a lookup that never fails (unknown or missing = "uncategorised"). */
export function useCategories() {
  const res = useResource<CategoryList>('categories', () => api('/categories'));
  const list: CategoryInfo[] = [];
  const en = getLanguage() === 'en';
  res.data?.builtin.forEach((c, i) => list.push({ ref: c.key, label: en ? c.en : c.so, icon: c.icon, tone: TONES[i % TONES.length], bar: BAR[i % BAR.length], archived: false }));
  res.data?.custom.forEach((c, i) => list.push({ ref: c.ref, label: c.name, icon: c.icon, tone: TONES[(i + 2) % TONES.length], bar: BAR[(i + 2) % BAR.length], archived: c.archived }));
  const map = new Map(list.map(c => [c.ref, c]));
  return {
    loading: res.loading && !res.data, error: res.error, reload: res.reload, icons: res.data?.icons ?? [], custom: res.data?.custom ?? [],
    active: list.filter(c => !c.archived),
    get: (ref: string | null | undefined): CategoryInfo => (ref && map.get(ref)) || UNCATEGORIZED(),
  };
}
export type Categories = ReturnType<typeof useCategories>;

export const CategoryIcon = ({ info, size = 'md' }: { info: CategoryInfo; size?: 'sm' | 'md' | 'lg' }) => {
  const box = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : 'w-11 h-11';
  const icon = size === 'sm' ? 'text-[17px]' : 'text-[22px]';
  return <div className={`${box} rounded-full flex items-center justify-center shrink-0 ${info.tone}`}><Icon name={info.icon} className={icon} /></div>;
};

/** Thin progress bar. Over 100% is shown full in the error colour. */
export function Progress({ percent, tone }: { percent: number; tone: 'ok' | 'warn' | 'over' }) {
  const color = tone === 'over' ? 'bg-error' : tone === 'warn' ? 'bg-tertiary-container' : 'bg-primary-container';
  return <div className="h-2 rounded-full bg-surface-container-high overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(percent))}>
    <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${Math.min(100, Math.max(percent > 0 ? 3 : 0, percent))}%` }} /></div>;
}

/** Grid of category tiles (wraps on narrow screens) plus "add your own". */
export function CategoryGrid({ cats, value, onPick, allowNone }: { cats: Categories; value: string | null; onPick: (ref: string | null) => void; allowNone?: boolean }) {
  const [adding, setAdding] = useState(false);
  const tile = (key: string, selected: boolean, onClick: () => void, icon: React.ReactNode, label: string) =>
    <button key={key} type="button" onClick={onClick} aria-pressed={selected}
      className={`min-h-[76px] p-2 rounded-2xl flex flex-col items-center justify-center gap-1 text-center pressable border-2 ${selected ? 'border-primary-container bg-primary-fixed/50' : 'border-transparent bg-surface-container-low'}`}>
      {icon}<span className="text-[12.5px] leading-[1.25] font-semibold text-on-surface [overflow-wrap:break-word] line-clamp-2 w-full">{label}</span></button>;
  return <>
    <div className="grid grid-cols-3 @min-[440px]:grid-cols-4 gap-2">
      {allowNone && tile('none', value === null, () => onPick(null), <CategoryIcon size="sm" info={cats.get(null)} />, t('Midna', 'None'))}
      {cats.active.map(c => tile(c.ref, value === c.ref, () => onPick(c.ref), <CategoryIcon size="sm" info={c} />, c.label))}
      {tile('add', false, () => setAdding(true), <div className="w-8 h-8 rounded-full border-2 border-dashed border-outline flex items-center justify-center text-on-surface-variant"><Icon name="add" className="text-[18px]" /></div>, t('Qayb cusub', 'New category'))}
    </div>
    {adding && <CategoryEditor cats={cats} onClose={() => setAdding(false)} onSaved={ref => { setAdding(false); onPick(ref); }} />}
  </>;
}

/** Create or rename a custom category. */
export function CategoryEditor({ cats, editing, onClose, onSaved }: { cats: Categories; editing?: { id: string; name: string; icon: string }; onClose: () => void; onSaved: (ref: string) => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? cats.icons[0] ?? 'sell');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!name.trim()) { setError(t('Geli magaca qaybta.', 'Enter a category name.')); return; }
    setBusy(true);
    try {
      const r = editing ? await api(`/categories/${editing.id}`, { method: 'PATCH', body: { name: name.trim(), icon } })
        : await api<{ ref: string }>('/categories', { method: 'POST', body: { name: name.trim(), icon } });
      cats.reload();
      onSaved(editing ? `custom:${editing.id}` : r.ref);
    } catch (err) { setError(offlineAware(err)); } finally { setBusy(false); }
  }
  return <Sheet open onClose={onClose} title={editing ? t('Wax ka beddel qaybta', 'Edit category') : t('Qayb cusub', 'New category')}>
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field label={t('Magaca', 'Name')}><input autoFocus value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder={t('Tusaale: Dharka', 'e.g. Clothes')} className={INPUT} /></Field>
      <div className="flex flex-col gap-1.5"><span className={LABEL}>{t('Calaamadda', 'Icon')}</span>
        <div className="grid grid-cols-6 gap-2">{cats.icons.map(i => <button key={i} type="button" aria-pressed={icon === i} aria-label={i} onClick={() => setIcon(i)}
          className={`aspect-square rounded-2xl flex items-center justify-center pressable ${icon === i ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface-variant'}`}><Icon name={i} className="text-[22px]" /></button>)}</div></div>
      {error && <p role="alert" className="text-[13px] text-error">{error}</p>}
      <Button disabled={busy} icon={busy ? 'progress_activity' : 'check'} spin={busy}>{t('Kaydi', 'Save')}</Button>
    </form>
  </Sheet>;
}

export const LABEL = 'px-1 text-[13px] font-semibold text-on-surface-variant';
export const INPUT = 'w-full min-h-[52px] py-2 bg-surface-container-low rounded-2xl px-4 text-[16px] text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary-container leading-tight';
export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className={LABEL}>{label}</span>{children}
    {hint && !error && <span className="px-1 text-[12.5px] leading-[1.36] text-on-surface-variant">{hint}</span>}
    {error && <span role="alert" className="px-1 text-[13px] text-error">{error}</span>}</label>;
}

/** Segmented choice (wraps when the screen is narrow or the text is large). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 p-1 rounded-[22px] bg-surface-container">
    {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
      className={`grow min-h-9 py-1 px-3 rounded-full text-[13.5px] font-semibold whitespace-nowrap transition-all duration-200 leading-tight ${value === v ? 'bg-surface-container-lowest text-on-surface shadow-[0_1px_4px_rgba(14,26,19,0.14)]' : 'text-on-surface-variant'}`}>{text}</button>)}
  </div>;
}

/** Saving money data needs the server (there is no offline queue for expenses), so say so plainly. */
export function offlineAware(err: unknown): string {
  const f = err as { status?: number; message?: string };
  if (f?.status === 0) return t('Internet ma jiro — lama kaydin. Isku day markaad khad hesho.', 'No internet — not saved. Try again when you are online.');
  return f?.message ?? t('Codsigu ma guuleysan.', 'The request failed.');
}
