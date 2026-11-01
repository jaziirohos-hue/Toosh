/**
 * Linking SIMs on this Android phone to EVC Plus numbers, so incoming EVC SMS on that SIM are recorded for that
 * number. Used by the source-phone setup screen and by SIM Card detection.
 */
import { api, type ApiFailure } from './api.ts';
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
