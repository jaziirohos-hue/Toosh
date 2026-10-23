/**
 * SIM card records: a person's own list of the SIM cards they use (name, number, network, date, notes).
 * A record is only a note in Toosh. Adding, editing or deleting it never changes the real SIM or the mobile network.
 */
import { isIsoDate, type Validation } from './finance.ts';
import { normalizeSomaliSimNumber } from './phone.ts';

export const SIM_PROVIDERS = ['HORMUUD', 'SOMTEL', 'GOLIS', 'OTHER'] as const;
export type SimProvider = (typeof SIM_PROVIDERS)[number];
export const SIM_PROVIDER_NAMES: Record<SimProvider, string> = { HORMUUD: 'Hormuud', SOMTEL: 'Somtel', GOLIS: 'Golis', OTHER: 'Kale' };

export interface SimCardInput { name: string; phone: string; provider: SimProvider; registeredOn: string; notes: string | null }

const clean = (v: unknown, max: number): string | null =>
  (typeof v === 'string' && v.trim() && v.trim().length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v) ? v.trim() : null);

/** `today` is the account's local date; a registration date cannot be in the future. */
export function validateSimCard(input: any, today: string): Validation<SimCardInput> {
  const errors: Record<string, string> = {};
  const b = input && typeof input === 'object' ? input : {};
  const name = clean(b.name, 60);
  if (!name) errors.name = 'Geli magaca SIM-ka (ilaa 60 xaraf).';
  const phone = normalizeSomaliSimNumber(typeof b.phone === 'string' ? b.phone : '');
  if (!phone.ok) errors.phone = 'Geli lambar taleefan Soomaali ah oo sax ah (sida 61 512 3456).';
  if (!SIM_PROVIDERS.includes(b.provider)) errors.provider = 'Dooro shirkadda: Hormuud, Somtel, Golis ama Kale.';
  if (!isIsoDate(b.registeredOn)) errors.registeredOn = 'Geli taariikh sax ah.';
  else if (b.registeredOn > today) errors.registeredOn = 'Taariikhdu ma noqon karto mustaqbalka.';
  else if (b.registeredOn < '1990-01-01') errors.registeredOn = 'Taariikh aad u fog.';
  let notes: string | null = null;
  if (b.notes !== undefined && b.notes !== null && b.notes !== '') {
    notes = clean(b.notes, 500);
    if (!notes) errors.notes = 'Qoraalku waa ugu badnaan 500 xaraf.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name: name!, phone: (phone as { e164: string }).e164, provider: b.provider, registeredOn: b.registeredOn, notes } };
}
