import { useEffect, useRef, type ReactNode } from 'react';
import { money, masked, shortDateTime } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useConnection } from '../lib/sync.ts';
import type { Message } from '../lib/types.ts';

export const Icon = ({ name, className = '', fill = false, style }: { name: string; className?: string; fill?: boolean; style?: React.CSSProperties }) =>
  <span aria-hidden="true" className={`material-symbols-outlined ${fill ? 'icon-fill' : ''} ${className}`} style={style}>{name}</span>;

export const Logo = ({ className = 'h-8 w-8' }: { className?: string }) => <img alt="Toosh App Logo" className={`${className} object-contain`} src="./toosh-logo.svg" />;

/** "Isku xiran" pill: reflects the real connection to the server. */
export function ConnectionPill() {
  const c = useConnection();
  const label = c === 'online' ? 'Isku xiran' : c === 'connecting' ? 'Isku xirmaya' : 'Offline';
  const dot = c === 'online' ? 'bg-primary-container animate-pulse' : c === 'connecting' ? 'bg-secondary animate-pulse' : 'bg-outline';
  return <div role="status" aria-live="polite" className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
    <span className={`w-2 h-2 rounded-full ${dot}`} /><span className="font-label-ui text-label-ui text-on-surface">{label}</span>
  </div>;
}

export function Header({ subtitle, msisdn, back, title }: { subtitle?: string; msisdn?: string | null; back?: () => void; title?: string }) {
  return <header className="fixed top-0 inset-x-0 z-50 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.03)] pt-safe">
    <div className="h-16 px-margin flex items-center justify-between gap-space-sm max-w-3xl mx-auto">
      <div className="flex items-center gap-space-sm min-w-0">
        {back && <button aria-label="Dib u noqo" onClick={back} className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors"><Icon name="arrow_back" className="text-[24px]" /></button>}
        <Logo className={back ? 'h-7 w-7' : 'h-8 w-8'} />
        {title ? <h1 className="font-title-lg text-title-lg text-on-surface tracking-tight truncate ml-1">{title}</h1>
          : <div className="flex flex-col truncate"><span className="font-title-md text-title-md text-primary tracking-tight leading-none">Toosh</span>
            <span className="font-label-ui text-label-ui text-on-surface-variant tracking-wider uppercase mt-0.5 truncate">{subtitle}</span></div>}
      </div>
      <div className="flex items-center gap-space-xs shrink-0">
        {!title && <ConnectionPill />}
        {msisdn && !title && <div className="hidden sm:flex items-center px-2 py-1 rounded-full bg-surface-container-lowest shadow-[0_1px_3px_rgba(15,23,42,0.04)]"><span className="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">{masked(msisdn)}</span></div>}
        <button aria-label="Akoonka iyo dejinta" onClick={() => navigate('dejinta')} className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0"><Icon name="person" className="text-on-primary text-[18px]" /></button>
      </div>
    </div>
  </header>;
}

export function BottomNav({ active, pending }: { active: string; pending: number }) {
  const item = (path: string, icon: string, label: string, badge?: number) => {
    const on = active === path;
    return <a href={`#/${path}`} aria-current={on ? 'page' : undefined}
      className={`relative flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1 transition-colors ${on ? 'text-primary-container font-semibold' : 'text-on-surface-variant hover:text-primary-container'}`}>
      <div className="relative flex items-center justify-center"><Icon name={icon} className="text-[24px]" />
        {badge ? <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-primary-container text-on-primary font-label-numeric-sm text-[10px] leading-none flex items-center justify-center">{badge > 99 ? '99+' : badge}</span> : null}</div>
      <span className="font-label-ui text-label-ui mt-0.5">{label}</span>
    </a>;
  };
  return <nav className="fixed bottom-0 inset-x-0 z-50 bg-surface-container-lowest/95 backdrop-blur-xl shadow-[0_-2px_12px_rgba(0,0,0,0.05)] pb-safe">
    <div className="max-w-md mx-auto flex items-center justify-around h-16 px-space-xs">
      {item('guud', 'dashboard', 'Guud')}{item('fariimaha', 'sms', 'Fariimaha', pending)}{item('dhaqdhaqaaq', 'swap_horiz', 'Dhaqdhaqaaq')}{item('dejinta', 'settings', 'Dejinta')}
    </div>
  </nav>;
}

export const Main = ({ children, nav = true }: { children: ReactNode; nav?: boolean }) =>
  <main className={`flex-1 w-full max-w-md mx-auto px-margin pt-16 ${nav ? 'pb-28' : 'pb-safe'} bg-surface`}><div className="flex flex-col w-full gap-y-4 pt-4">{children}</div></main>;

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
    className={`w-12 h-6 rounded-full relative p-0.5 transition-colors shrink-0 disabled:opacity-40 ${checked ? 'bg-primary-container' : 'bg-surface-container-highest'}`}>
    <div className={`w-5 h-5 rounded-full bg-surface-container-lowest transition-transform shadow-sm ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
  </button>;
}

export function Banner({ tone, icon, children }: { tone: 'info' | 'warn' | 'error' | 'ok'; icon: string; children: ReactNode }) {
  const cls = tone === 'warn' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : tone === 'error' ? 'bg-error-container text-on-error-container'
    : tone === 'ok' ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-low text-on-surface-variant';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 p-3 rounded-xl ${cls}`}>
    <Icon name={icon} className="text-[18px] shrink-0 mt-0.5" /><div className="font-body-sm text-body-sm leading-relaxed min-w-0">{children}</div>
  </div>;
}

/** Transaction row used on Guud and Dhaqdhaqaaq (design: "Transaction Items"). */
export function TxRow({ m, tz, variant = 'guud' }: { m: Message; tz: string; variant?: 'guud' | 'list' }) {
  const t = m.transaction!;
  const out = t.direction === 'OUT';
  const manual = m.classificationSource === 'MANUAL';
  const name = t.counterpartyName ?? (out ? 'Lacag baxday' : 'Lacag soo gashay');
  const iconName = variant === 'guud' ? (out ? 'south_west' : 'north_east') : out ? 'arrow_upward' : 'arrow_downward';
  return <button type="button" onClick={() => navigate(`fariin/${m.id}`)}
    className="w-full text-left flex items-center justify-between gap-3 bg-surface-container-lowest p-3 rounded-xl shadow-sm active:scale-[0.99] transition-all">
    <div className="flex items-center gap-3 min-w-0">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${out ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed text-on-primary-fixed'}`}><Icon name={iconName} className="text-[20px]" /></div>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-title-md text-body-md text-on-surface font-semibold truncate">{name}</span>
          {variant === 'guud' && <span className={`text-[9px] font-label-ui px-1.5 rounded font-bold uppercase shrink-0 ${out ? 'bg-error-container/40 text-on-error-container' : 'bg-primary-fixed/50 text-on-primary-fixed-variant'}`}>{out ? 'Baxay' : 'Soo galay'}</span>}
        </div>
        {t.counterpartyPhone && <span className="font-label-numeric-sm text-[11px] text-on-surface-variant truncate">{masked(t.counterpartyPhone)}</span>}
        <span className="font-body-sm text-[10px] text-on-surface-variant flex items-center gap-1 mt-0.5">
          <span>{shortDateTime(t.occurredAt, tz)}</span><span>•</span>
          {manual ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed font-label-ui text-[10px] leading-none"><Icon name="edit_note" className="text-[10px]" />Gacanta lagu saxay</span>
            : <span className="text-secondary font-medium">SMS toos ah</span>}
        </span>
      </div>
    </div>
    <div className="flex flex-col items-end shrink-0 pl-2">
      <span className={`font-label-numeric-md text-label-numeric-md font-bold ${out ? 'text-error' : 'text-primary-container'}`}>{money(t.amount, out ? '-' : '+')}</span>
      {m.balance && <span className="font-label-numeric-sm text-[10px] text-on-surface-variant mt-0.5">Haraaga: {money(m.balance.amount)}</span>}
    </div>
  </button>;
}

/** Modal bottom sheet (design: 24px top radii). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} onClose={onClose} aria-label={title}
    className="m-0 mt-auto w-full max-w-md mx-auto rounded-t-3xl bg-surface-container-lowest p-0 text-on-surface shadow-[0px_8px_24px_-4px_rgba(15,23,42,0.08)] backdrop:bg-inverse-surface/40 max-h-[90dvh]">
    <div className="p-4 pb-safe flex flex-col gap-3">
      <div className="flex items-center justify-between"><h2 className="font-title-lg text-title-lg">{title}</h2>
        <button aria-label="Xir" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container"><Icon name="close" /></button></div>
      {children}
    </div>
  </dialog>;
}

export function Spinner({ label }: { label: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-6 text-on-surface-variant font-body-sm text-body-sm"><Icon name="sync" className="animate-spin text-[18px]" />{label}</div>;
}

export function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="flex flex-col items-center justify-center text-center py-10 px-4 bg-surface-container-lowest rounded-2xl shadow-sm">
    <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-3 text-on-surface-variant"><Icon name={icon} className="text-[28px]" /></div>
    <span className="font-title-md text-title-md text-on-surface">{title}</span>
    <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs mt-1">{text}</p>
  </div>;
}
