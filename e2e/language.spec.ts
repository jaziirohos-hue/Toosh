/** English is the default language; Somali stays one choice away and is remembered. */
import { expect, test } from '@playwright/test';

test('a new install opens in English', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Manage your expenses with ease.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
});

test('an app that only had the old default (Somali) now opens in English', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('toosh.prefs', JSON.stringify({ language: 'so', hideAmounts: false })); sessionStorage.setItem('seeded', '1'); } });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();
});

test('a chosen language is kept, and server errors follow it', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('toosh.prefs', JSON.stringify({ language: 'so', languageChosen: true })); sessionStorage.setItem('seeded', '1'); } });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Gal Akoonka' })).toBeVisible();
  // Back to English: a wrong password shows the server's error in English.
  await page.evaluate(() => localStorage.setItem('toosh.prefs', JSON.stringify({ language: 'en', languageChosen: true })));
  await page.reload();
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.locator('#phone-number').fill('619999999');
  await page.locator('#password').fill('not the password');
  await page.getByRole('button', { name: /^Open Toosh/ }).click();
  await expect(page.getByText('Wrong number or password.')).toBeVisible();
});
