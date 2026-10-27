/**
 * The app opens in English by default. Most browser tests check the Somali screens, so they pick Somali the way a
 * person would (a saved language choice), once per fresh browser, without overwriting later preference changes.
 */
import type { Page } from '@playwright/test';
export const useSomali = (page: Page) => page.addInitScript(() => {
  if (!localStorage.getItem('toosh.prefs')) localStorage.setItem('toosh.prefs', JSON.stringify({ language: 'so', languageChosen: true }));
});
