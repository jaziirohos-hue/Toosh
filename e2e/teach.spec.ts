/** "Bar Toosh" on the web: the taught formats are listed and can be removed (phone messages need the Android app). */
import { expect, test } from '@playwright/test';
import { useSomali } from './somali.ts';

test.beforeEach(async ({ page }) => { await useSomali(page); });

test('taught formats are listed on the phone-messages screen and can be removed', async ({ page, request }) => {
  const phone = `61${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const reg = await (await request.post('/api/v1/auth/register', { data: { displayName: 'Bare', phone, password: 'correct horse battery', device: { platform: 'android', name: 'A54' } } })).json();
  const auth = { authorization: `Bearer ${reg.token}` };
  const body = '[-EDAHAB-] Waxaad $12.50 u dirtay CABDI XASAN NUUR(659998877) 03/11/26 10:20:30. Haraagaaga waa $40.25 Mahadsanid';
  const r = await request.post('/api/v1/rules', { headers: auth, data: { sender: 'EDAHAB', body, direction: 'OUT', amount: '12.50', balance: '40.25' } });
  expect(r.status()).toBe(201);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Gal Akoonka' }).click();
  await page.locator('#phone-number').fill(phone);
  await page.locator('#password').fill('correct horse battery');
  await page.getByRole('button', { name: /^Fur Toosh/ }).click();
  await expect(page.getByTestId('fin-income')).toBeVisible();
  await page.goto('/#/fariimaha');
  await page.locator('#phoneMessagesBtn').click();
  await expect(page.getByText('Fariimaha taleefanka waxaa laga arkaa app-ka Android')).toBeVisible();
  await expect(page.getByTestId('taught-rule')).toHaveCount(1);
  await expect(page.getByTestId('taught-rule')).toContainText('EDAHAB');
  await expect(page.getByTestId('taught-rule')).toContainText('Baxay');
  await page.getByRole('button', { name: 'Ka saar EDAHAB' }).click();
  await page.getByRole('button', { name: 'Ka saar', exact: true }).click();
  await expect(page.getByTestId('taught-rule')).toHaveCount(0);
  const left = await (await request.get('/api/v1/rules', { headers: auth })).json();
  expect(left.rules).toHaveLength(0);
});
