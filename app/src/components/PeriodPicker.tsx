import { useState } from 'react';
import { localDate } from '@toosh/shared';
import type { PeriodChoice } from '../lib/types.ts';
import { Icon, Sheet } from './ui.tsx';

export const periodQuery = (p: PeriodChoice) => (p.period === 'custom' ? { period: 'custom', from: p.from, to: p.to } : { period: p.period });

export function periodLabel(p: PeriodChoice): string {
  if (p.period === 'today') return 'Maanta';
  if (p.period === 'week') return 'Toddobaadkan';
  if (p.period === 'month') return 'Bishan';
  if (p.period === 'custom') return p.from === p.to ? p.from : `${p.from} → ${p.to}`;
  return 'Dhammaan waqtiyada';
}

/** Custom range dialog. Dates are calendar days in the account timezone. */
export function DateRangeSheet({ open, onClose, value, onPick, tz }: { open: boolean; onClose: () => void; value: PeriodChoice; onPick: (p: PeriodChoice) => void; tz: string }) {
  const today = localDate(new Date(), tz);
  const [from, setFrom] = useState(value.period === 'custom' ? value.from : today);
  const [to, setTo] = useState(value.period === 'custom' ? value.to : today);
  const invalid = !from || !to || from > to;
  return <Sheet open={open} onClose={onClose} title="Taariikh dooro">
    <p className="font-body-sm text-body-sm text-on-surface-variant">Maalmaha waxaa loo xisaabiyaa waqtiga akoonka ({tz}).</p>
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-on-surface-variant">Laga bilaabo
        <input type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} className="min-h-12 py-2 bg-surface-container-low text-on-surface text-[15px] font-medium normal-case tracking-normal px-3 rounded-xl leading-tight" /></label>
      <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-on-surface-variant">Ilaa
        <input type="date" value={to} max={today} onChange={e => setTo(e.target.value)} className="min-h-12 py-2 bg-surface-container-low text-on-surface text-[15px] font-medium normal-case tracking-normal px-3 rounded-xl leading-tight" /></label>
    </div>
    {invalid && <p role="alert" className="font-body-sm text-body-sm text-error">Taariikhda dhammaadka waa inay ka dambeysaa ama la mid tahay bilowga.</p>}
    <button type="button" disabled={invalid} onClick={() => { onPick({ period: 'custom', from, to }); onClose(); }}
      className="w-full min-h-[52px] py-2 bg-primary-container text-on-primary rounded-2xl text-[16px] font-bold disabled:opacity-50 pressable leading-tight">Dooro</button>
  </Sheet>;
}

/** Segmented control: Maanta | Toddobaadkan | Bishan | calendar (custom range). */
export function PeriodChips({ value, onChange, tz }: { value: PeriodChoice; onChange: (p: PeriodChoice) => void; tz: string }) {
  const [open, setOpen] = useState(false);
  const seg = (active: boolean) => `shrink-0 min-h-9 py-1 px-3 rounded-full text-[13.5px] leading-tight font-semibold whitespace-nowrap transition-all duration-200 flex items-center justify-center gap-1 ${active ? 'bg-surface-container-lowest text-on-surface shadow-[0_1px_4px_rgba(14,26,19,0.14)]' : 'text-on-surface-variant'}`;
  const custom = value.period === 'custom';
  return <>
    <div className="flex flex-wrap items-center gap-1 p-1 rounded-[22px] bg-surface-container" role="group" aria-label="Muddada">
      {(['today', 'week', 'month'] as const).map(p => <button key={p} type="button" aria-pressed={value.period === p} className={`${seg(value.period === p)} grow`} onClick={() => onChange({ period: p })}>{periodLabel({ period: p })}</button>)}
      <button type="button" aria-pressed={custom} aria-label="Taariikh dooro" className={`${seg(custom)} !px-3`} onClick={() => setOpen(true)}>
        <Icon name="calendar_month" className="text-[19px]" /></button>
    </div>
    {custom && <button type="button" onClick={() => setOpen(true)} className="-mt-2 self-start flex items-center gap-1.5 min-h-8 py-1 px-3 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[13px] font-semibold leading-tight">
      <Icon name="date_range" className="text-[16px]" />{periodLabel(value)}<Icon name="edit" className="text-[14px]" /></button>}
    {open && <DateRangeSheet open={open} onClose={() => setOpen(false)} value={value} onPick={onChange} tz={tz} />}
  </>;
}
