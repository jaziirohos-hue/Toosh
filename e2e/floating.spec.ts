/** The floating "Ku dar qarash" button stays above the bottom bar and leaves the end of the list readable. */
import { expect, test } from '@playwright/test';

for (const zoom of [1, 1.3]) test(`the floating Add button never covers the end of the expense list at ${Math.round(zoom * 100)}% font size`, async ({ page, request }) => {
  const phone = `61${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const reg = await (await request.post('/api/v1/auth/register', { data: { displayName: 'Test', phone, password: 'layout test password', device: { platform: 'android', name: 'A' } } })).json();
  const auth = { authorization: `Bearer ${reg.token}` };
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 6; i++) await request.post('/api/v1/expenses', { headers: auth, data: { name: `Qarash ${i}`, amount: '5', currency: 'USD', category: 'cuntada', spentOn: today, paymentStatus: 'PAID' } });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Gal Akoonka' }).click();
  await page.locator('#phone-number').fill(phone);
  await page.locator('#password').fill('layout test password');
  await page.getByRole('button', { name: /^Fur Toosh/ }).click();
  await page.waitForTimeout(800);
  await page.goto('/#/qarash');
  await expect(page.getByText('Qarash 5')).toBeVisible();
  await page.evaluate(z => { document.documentElement.style.zoom = String(z); document.documentElement.style.setProperty('--app-zoom', String(z)); }, zoom);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const fab = await page.locator('#addExpenseBtn').boundingBox();
  const link = await page.getByRole('button', { name: 'Maamul qaybaha' }).boundingBox();
  const note = await page.getByText(/USD iyo SOS lama isku darin/).boundingBox();

  const overlap = (a: any, b: any) => a.y < b.y + b.height && b.y < a.y + a.height && a.x < b.x + b.width && b.x < a.x + a.width;
  expect(overlap(fab, link), 'FAB covers the link').toBe(false);
  expect(overlap(fab, note), 'FAB covers the note').toBe(false);
});
