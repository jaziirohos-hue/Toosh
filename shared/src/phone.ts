/**
 * Somali mobile numbers. Everything is stored in E.164 form (+2526XXXXXXXX) so the same number typed as
 * "061 512 3456", "615123456", "252615123456" or "+252 61 512 3456" is one number.
 */
export type PhoneResult = { ok: true; e164: string } | { ok: false; error: 'EMPTY' | 'FORMAT' | 'NOT_MOBILE' };

const NATIONAL = /^[67]\d{8}$/; // Somali mobile ranges are 9 national digits starting with 6 or 7

export function normalizeSomaliMsisdn(input: string): PhoneResult {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'EMPTY' };
  if (/[^\d\s+().\-]/.test(raw)) return { ok: false, error: 'FORMAT' };
  let digits = raw.replace(/[\s().\-]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
    if (!digits.startsWith('252')) return { ok: false, error: 'NOT_MOBILE' };
  }
  if (/\+/.test(digits)) return { ok: false, error: 'FORMAT' };
  if (digits.startsWith('00252')) digits = digits.slice(5);
  else if (digits.startsWith('252') && digits.length === 12) digits = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return { ok: false, error: 'FORMAT' };
  if (!NATIONAL.test(digits)) return { ok: false, error: 'NOT_MOBILE' };
  return { ok: true, e164: `+252${digits}` };
}

/** Lenient variant for SMS text: returns null instead of an error (redacted numbers like 61XXXXXXX give null). */
export function phoneFromSms(text: string | null | undefined): string | null {
  if (!text) return null;
  const r = normalizeSomaliMsisdn(text);
  return r.ok ? r.e164 : null;
}

/** "+252 61 512 3456" */
export function formatMsisdn(e164: string): string {
  const m = /^\+252(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+252 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** "+252 61 ••• ••34": used wherever a number is shown at a glance. */
export function maskMsisdn(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+252(\d{2})\d{5}(\d{2})$/.exec(e164);
  return m ? `+252 ${m[1]} ••• ••${m[2]}` : '•••';
}

/** Hormuud (EVC Plus) ranges. Used only as a hint in the UI, never as verification. */
export function looksLikeHormuud(e164: string): boolean {
  return /^\+252(61|77)/.test(e164);
}
