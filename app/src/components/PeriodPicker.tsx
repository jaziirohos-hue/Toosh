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
      <label className="flex flex-col gap-1 font-label-ui text-label-ui uppercase tracking-wider text-on-surface-variant">Laga bilaabo
        <input type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} className="bg-surface-container-low text-on-surface font-body-md text-body-md normal-case tracking-normal px-3 py-2.5 rounded-lg" /></label>
      <label className="flex flex-col gap-1 font-label-ui text-label-ui uppercase tracking-wider text-on-surface-variant">Ilaa
        <input type="date" value={to} max={today} onChange={e => setTo(e.target.value)} className="bg-surface-container-low text-on-surface font-body-md text-body-md normal-case tracking-normal px-3 py-2.5 rounded-lg" /></label>
    </div>
    {invalid && <p role="alert" className="font-body-sm text-body-sm text-error">Taariikhda dhammaadka waa inay ka dambeysaa ama la mid tahay bilowga.</p>}
    <button type="button" disabled={invalid} onClick={() => { onPick({ period: 'custom', from, to }); onClose(); }}
      className="w-full h-12 bg-primary-container text-on-primary rounded-lg font-title-md text-title-md disabled:opacity-50">Dooro</button>
  </Sheet>;
}

/** Chip row from the Guud design: Maanta, Toddobaadkan, Bishan, Taariikh dooro. */
export function PeriodChips({ value, onChange, tz }: { value: PeriodChoice; onChange: (p: PeriodChoice) => void; tz: string }) {
  const [open, setOpen] = useState(false);
  const chip = (active: boolean) => `shrink-0 px-3.5 py-1.5 rounded-full font-label-ui text-label-ui transition-colors ${active ? 'bg-primary-container text-on-primary shadow-sm' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`;
  return <>
    <div className="flex items-center gap-2 overflow-x-auto py-1 -mx-margin px-margin no-scrollbar" role="group" aria-label="Muddada">
      {(['today', 'week', 'month'] as const).map(p => <button key={p} type="button" aria-pressed={value.period === p} className={chip(value.period === p)} onClick={() => onChange({ period: p })}>{periodLabel({ period: p })}</button>)}
      <button type="button" aria-pressed={value.period === 'custom'} className={`${chip(value.period === 'custom')} inline-flex items-center gap-1`} onClick={() => setOpen(true)}>
        <Icon name="calendar_today" className="text-[14px]" /><span>{value.period === 'custom' ? periodLabel(value) : 'Taariikh dooro'}</span>
      </button>
    </div>
    {open && <DateRangeSheet open={open} onClose={() => setOpen(false)} value={value} onPick={onChange} tz={tz} />}
  </>;
}
