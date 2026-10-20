/**
 * Which SMS Toosh imports. Mirrored exactly in the Android receiver (EvcFilter.java); a shared test vector file
 * (shared/test/relevance-vectors.json) is checked by both implementations.
 *
 * strict (default): the sender must be a known EVC Plus sender AND the body must look like an EVC Plus message.
 * relaxed: any sender, as long as the body carries the [-EVCPlus-] provider tag (e.g. a message relayed by a
 * second SIM). Non-EVC messages are never imported in either mode.
 */
export const EVC_SENDERS = ['192', '321', 'EVCPLUS', 'EVC PLUS', 'HORMUUD'];

const TAG = /\[\s*-?\s*evc\s*-?\s*plus\s*-?\s*\]/i;
const EVC_WORDS = /\b(evc\s*-?\s*plus|haraag\w*|wareejis\w*|ka\s+heshay|ka\s+hesay)\b/i;

export function normalizeSender(sender: string): string {
  return String(sender ?? '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ');
}

export function hasEvcTag(body: string): boolean {
  return TAG.test(body ?? '');
}

export function isRelevantEvcMessage(sender: string, body: string, strict = true): boolean {
  const text = String(body ?? '');
  if (!text.trim()) return false;
  const known = EVC_SENDERS.includes(normalizeSender(sender));
  if (known && (hasEvcTag(text) || EVC_WORDS.test(text))) return true;
  if (!strict && hasEvcTag(text)) return true;
  return false;
}
