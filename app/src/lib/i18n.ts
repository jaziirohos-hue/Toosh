/**
 * English by default, Somali one tap away (Dejinta → Language). Every label is written as t('Somali', 'English') right where it is used, so no
 * string can be missing a translation. Changing the language re-renders the whole app (see App.tsx).
 */
export type Language = 'so' | 'en';
let lang: Language = 'en';
export function setLanguage(l: Language) {
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}
export const getLanguage = () => lang;
export const t = (so: string, en: string) => (lang === 'en' ? en : so);
