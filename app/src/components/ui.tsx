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
  const dot = c === 'online' ? 'bg-primary-container' : c === 'connecting' ? 'bg-secondary animate-pulse' : 'bg-outline';
  return <div role="status" aria-live="polite" className="flex items-center gap-1.5 min-h-8 py-1 pl-2.5 pr-3 @max-[330px]:px-3 rounded-full bg-surface-container-lowest border border-outline-variant/50 leading-tight shrink-0">
    <span className="relative flex w-2 h-2">{c === 'online' && <span className="absolute inset-0 rounded-full bg-primary-container/40 animate-ping" />}<span className={`relative w-2 h-2 rounded-full ${dot}`} /></span>
    <span className="text-[12px] leading-none font-semibold text-on-surface whitespace-nowrap @max-[330px]:sr-only">{label}</span>
  </div>;
}

/** Top app bar. Main tabs show the screen name as a large title; inner screens show a back arrow and title. */
export function Header({ subtitle, back, title }: { subtitle?: string; msisdn?: string | null; back?: () => void; title?: string }) {
  return <header className="fixed top-0 inset-x-0 z-50 bg-surface/85 backdrop-blur-xl pt-safe">
    <div className="@container h-16 px-4 flex items-center gap-2.5 max-w-md mx-auto">
      {back && <button aria-label="Dib u noqo" onClick={back} className="w-10 h-10 -ml-1.5 rounded-full flex items-center justify-center text-on-surface active:bg-surface-container-high transition-colors"><Icon name="arrow_back" /></button>}
      <h1 className={`flex-1 min-w-0 truncate text-on-surface tracking-tight ${back ? 'text-[18px] font-bold' : 'text-[clamp(20px,6.8cqw,26px)] leading-none font-extrabold pl-0.5'}`}>{title ?? subtitle}</h1>
      {!back && <>
        <ConnectionPill />
        <button aria-label="Akoonka iyo dejinta" onClick={() => navigate('dejinta')} className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center shrink-0 pressable"><Icon name="person" fill className="text-on-primary text-[20px]" /></button>
      </>}
    </div>
  </header>;
}

/** Material 3 navigation bar: active destination gets a pill behind its (filled) icon. */
export function BottomNav({ active, pending }: { active: string; pending: number }) {
  const item = (path: string, icon: string, label: string, badge?: number) => {
    const on = active === path;
    return <a href={`#/${path}`} aria-current={on ? 'page' : undefined} className="flex-1 flex flex-col items-center justify-center gap-1 h-full select-none">
      <div className={`relative w-16 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${on ? 'bg-primary-fixed' : ''}`}>
        <Icon name={icon} fill={on} className={`text-[24px] ${on ? 'text-on-primary-fixed-variant' : 'text-on-surface-variant'}`} />
        {badge ? <span className="absolute top-0 right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error text-[10.5px] font-bold leading-none flex items-center justify-center ring-2 ring-surface-container-lowest">{badge > 99 ? '99+' : badge}</span> : null}
      </div>
      <span className={`text-[12px] leading-none ${on ? 'font-bold text-on-surface' : 'font-medium text-on-surface-variant'}`}>{label}</span>
    </a>;
  };
  return <nav className="fixed bottom-0 inset-x-0 z-50 bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/40 pb-safe">
    <div className="max-w-md mx-auto flex items-stretch h-[68px] px-1">
      {item('guud', 'space_dashboard', 'Guud')}{item('fariimaha', 'sms', 'Fariimaha', pending)}{item('dhaqdhaqaaq', 'swap_vert', 'Dhaqdhaqaaq')}{item('dejinta', 'settings', 'Dejinta')}
    </div>
  </nav>;
}

export const Main = ({ children, nav = true }: { children: ReactNode; nav?: boolean }) =>
  <main className={`flex-1 w-full max-w-md mx-auto px-4 pt-header ${nav ? 'pb-nav' : 'pb-safe'} bg-surface`}><div className="@container screen-in flex flex-col w-full gap-4 pt-1">{children}</div></main>;

/** A white rounded card holding list rows separated by hairlines. */
export const Group = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <div className={`card overflow-hidden divide-y divide-outline-variant/40 ${className}`}>{children}</div>;

export const SectionTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) =>
  <div className="flex items-center justify-between gap-2 px-1 -mb-1.5 mt-1"><h2 className="min-w-0 break-words text-[17px] leading-[1.41] font-bold tracking-tight text-on-surface">{children}</h2>{action && <div className="shrink-0 whitespace-nowrap">{action}</div>}</div>;

/** Small uppercase label above a settings group. */
export const GroupLabel = ({ children }: { children: ReactNode }) =>
  <h2 className="px-1 -mb-2 mt-1 text-[12.5px] font-bold uppercase tracking-[0.07em] text-on-surface-variant">{children}</h2>;

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
    className={`w-[52px] h-8 rounded-full relative shrink-0 transition-colors duration-200 disabled:opacity-40 ${checked ? 'bg-primary-container' : 'bg-surface-container-highest'}`}>
    <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-surface-container-lowest shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 flex items-center justify-center ${checked ? 'translate-x-5' : 'translate-x-0'}`}>
      {checked && <Icon name="check" className="text-[16px] text-primary-container" />}</span>
  </button>;
}

export function Banner({ tone, icon, children }: { tone: 'info' | 'warn' | 'error' | 'ok'; icon: string; children: ReactNode }) {
  const cls = tone === 'warn' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : tone === 'error' ? 'bg-error-container text-on-error-container'
    : tone === 'ok' ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-secondary-fixed text-on-secondary-fixed';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 px-4 py-3 rounded-2xl ${cls}`}>
    <Icon name={icon} className="text-[20px] shrink-0" /><div className="text-[14px] leading-[1.43] min-w-0">{children}</div>
  </div>;
}

/** Transaction row for grouped lists (Guud, Dhaqdhaqaaq). The parent <Group> provides the card. */
export function TxRow({ m, tz }: { m: Message; tz: string; variant?: 'guud' | 'list' }) {
  const t = m.transaction!;
  const out = t.direction === 'OUT';
  const manual = m.classificationSource === 'MANUAL';
  const name = t.counterpartyName ?? (t.counterpartyPhone ? masked(t.counterpartyPhone) : out ? 'Lacag baxday' : 'Lacag soo gashay');
  const subParts = [shortDateTime(t.occurredAt, tz), t.counterpartyName && t.counterpartyPhone ? masked(t.counterpartyPhone) : out ? 'Baxay' : 'Soo galay'];
  return <button type="button" onClick={() => navigate(`fariin/${m.id}`)}
    className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 active:bg-surface-container-low transition-colors">
    <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${out ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed text-on-primary-fixed-variant'}`}>
      <Icon name={out ? 'north_east' : 'south_west'} className="text-[22px]" /></div>
    <div className="flex-1 min-w-[130px]">
      <div className="text-[15.5px] leading-[1.3] font-semibold text-on-surface line-clamp-2 break-words">{name}</div>
      <div className="text-[13px] leading-[1.38] text-on-surface-variant">{subParts.map((p, i) => <span key={i}>{i ? ' · ' : ''}<span className="whitespace-nowrap">{p}</span></span>)}</div>
      {manual && <span className="inline-flex items-center gap-1 mt-1 px-2 py-[3px] rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-[11.5px] leading-none font-semibold"><Icon name="edit" className="text-[12px]" />Gacanta lagu saxay</span>}
    </div>
    <div className="flex flex-col items-end shrink-0 pl-1 ml-auto">
      <span className={`text-[16px] leading-[1.38] font-bold tracking-tight ${out ? 'text-on-surface' : 'text-primary-container'}`}>{money(t.amount, out ? '-' : '+')}</span>
      {m.balance && <span className="text-[12px] leading-[1.33] text-on-surface-variant">{money(m.balance.amount)}</span>}
    </div>
  </button>;
}

/** Modal bottom sheet with a drag handle. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} onClose={onClose} aria-label={title} onClick={e => { if (e.target === ref.current) onClose(); }}
    className="m-0 mt-auto w-full max-w-md mx-auto rounded-t-[28px] bg-surface-container-lowest p-0 text-on-surface shadow-[0_-8px_32px_rgba(14,26,19,0.12)] backdrop:bg-inverse-surface/45 max-h-[calc(90dvh/var(--app-zoom,1))]">
    <div className="px-5 pt-2.5 pb-safe flex flex-col gap-4">
      <div className="mx-auto w-9 h-1 rounded-full bg-outline-variant" />
      <div className="flex items-center justify-between -mt-1"><h2 className="text-[20px] font-bold tracking-tight">{title}</h2>
        <button aria-label="Xir" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center bg-surface-container-low active:bg-surface-container"><Icon name="close" className="text-[20px]" /></button></div>
      {children}
      <div className="h-2" />
    </div>
  </dialog>;
}

export function Spinner({ label }: { label: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-8 text-on-surface-variant text-[14px]"><Icon name="progress_activity" className="animate-spin text-[20px] text-primary-container" />{label}</div>;
}

export function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="card flex flex-col items-center justify-center text-center py-10 px-6">
    <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center mb-4 text-on-surface-variant"><Icon name={icon} className="text-[30px]" /></div>
    <span className="text-[17px] font-bold text-on-surface">{title}</span>
    <p className="text-[14px] leading-[1.43] text-on-surface-variant max-w-xs mt-1.5">{text}</p>
  </div>;
}

/** Primary / secondary / danger buttons with consistent size and press feedback. */
export function Button({ kind = 'primary', icon, children, className = '', spin, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'tonal' | 'danger' | 'warn' | 'ghost'; icon?: string; spin?: boolean }) {
  const cls = kind === 'primary' ? 'bg-primary-container text-on-primary shadow-[0_6px_16px_-6px_rgba(10,107,63,0.55)]'
    : kind === 'danger' ? 'bg-error-container text-on-error-container' : kind === 'warn' ? 'bg-tertiary-container text-on-tertiary'
    : kind === 'ghost' ? 'bg-transparent text-primary-container' : 'bg-surface-container text-on-surface';
  return <button {...rest} className={`min-h-[52px] py-2 px-5 rounded-2xl text-[16px] font-bold flex items-center justify-center gap-2 pressable disabled:opacity-55 ${cls} ${className} leading-tight`}>
    {icon && <Icon name={icon} className={`text-[20px] ${spin ? 'animate-spin' : ''}`} />}{children}</button>;
}
