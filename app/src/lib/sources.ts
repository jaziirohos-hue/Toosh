/**
 * Linking SIMs on this Android phone to EVC Plus numbers, so incoming EVC SMS on that SIM are recorded for that
 * number. Used by the source-phone setup screen and by SIM Card detection.
 */
import { api, type ApiFailure } from './api.ts';
import { t } from './i18n.ts';
import { TooshNative, type Sim } from './native.ts';
import type { EvcNumber } from './types.ts';

/** Sends this phone's current SIM→number links to the native SMS reader. */
export async function syncNativeMappings(strictFilter: boolean) {
  const fresh = await api<{ evcNumbers: EvcNumber[]; device: { id: string }; account: { id: string } }>('/me');
  const mappings = fresh.evcNumbers.filter(n => n.sourceDeviceId === fresh.device.id)
    .map(n => ({ subscriptionId: n.simSubscriptionId, simSlot: n.simSlot, evcNumberId: n.id, accountId: fresh.account.id }));
  await TooshNative.setSourceMappings({ mappings, strictFilter });
}

export const simLabel = (sim: Pick<Sim, 'simSlot' | 'carrierName'>) => `SIM ${sim.simSlot + 1}${sim.carrierName ? ` · ${sim.carrierName}` : ''}`;

/**
 * Makes this phone the SMS source for `numberId` on the given SIM. Returns 'linked', or the reason it was not:
 * another phone already reads this number ('other-phone'), or this SIM is already linked to another number.
 */
export async function linkSim(numberId: string, sim: Pick<Sim, 'subscriptionId' | 'simSlot' | 'carrierName'>): Promise<'linked' | 'other-phone' | 'sim-in-use'> {
  try {
    await api(`/evc-numbers/${numberId}/source`, { method: 'POST', body: { simSubscriptionId: sim.subscriptionId, simSlot: sim.simSlot, simLabel: simLabel(sim) } });
    return 'linked';
  } catch (e) {
    const code = (e as ApiFailure).code;
    if (code === 'SOURCE_EXISTS') return 'other-phone';
    if (code === 'SIM_IN_USE') return 'sim-in-use';
    throw e;
  }
}

/** Asks for the permissions needed to read EVC SMS for a SIM; returns an error text when one is refused. */
export async function ensureSmsPermission(): Promise<string | null> {
  const status = await TooshNative.getStatus();
  if (status.smsPermission === 'GRANTED') return null;
  const r = await TooshNative.requestSmsPermission();
  return r.state === 'GRANTED' ? null : t('Ogolaanshaha SMS lama bixin, sidaas darteed lacagaha lama soo qaban karo. Ka fur Settings-ka taleefanka.', 'SMS permission was not given, so money cannot be recorded. Allow it in the phone settings.');
}

/** Makes `phone` an EVC number of the account (if it is not already) and links it to `sim` on this phone. */
export async function trackOnThisPhone(phone: string, name: string, sim: Pick<Sim, 'subscriptionId' | 'simSlot' | 'carrierName'>, evcNumbers: EvcNumber[], strict: boolean): Promise<string | null> {
  const denied = await ensureSmsPermission();
  if (denied) return denied;
  let number = evcNumbers.find(n => n.msisdn === phone);
  if (!number) number = await api<EvcNumber>('/evc-numbers', { method: 'POST', body: { msisdn: phone, displayName: name } });
  const r = await linkSim(number.id, sim);
  if (r === 'other-phone') return t(`${name}: taleefan kale ayaa horay u akhriya SMS-ka lambarkan.`, `${name}: another phone already reads this number's SMS.`);
  if (r === 'sim-in-use') return t(`${name}: SIM-kan waxaa horay loogu xiray lambar kale.`, `${name}: this SIM is already linked to another number.`);
  await syncNativeMappings(strict);
  return null;
}


/** Sends the account's taught formats to the phone so it keeps SMS that fit them (Android only). */
export async function syncRulesToPhone() {
  const r = await api<{ patterns: { id: string; sender: string; pattern: string; direction: string }[] }>('/rules');
  await TooshNative.setLearnedRules({ rules: r.patterns });
  return r.patterns.length;
}
