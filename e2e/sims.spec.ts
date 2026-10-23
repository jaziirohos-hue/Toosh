/** SIM Card section (Dejinta → SIM Card): add, list, search, filter, edit, delete with confirmation. */
import { expect, test } from '@playwright/test';

const PASSWORD = 'correct horse battery';

test('SIM cards: add, search, filter, edit, delete only after confirming', async ({ page, request }) => {
  const phone = `61${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const reg = await (await request.post('/api/v1/auth/register', { data: { displayName: 'Cabdi Xasan', phone, password: PASSWORD, device: { platform: 'android', name: 'A54' } } })).json();
  const other = `61${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const otherReg = await (await request.post('/api/v1/auth/register', { data: { displayName: 'Other', phone: other, password: PASSWORD, device: { platform: 'android', name: 'B' } } })).json();
  await request.post('/api/v1/sim-cards', { headers: { authorization: `Bearer ${otherReg.token}` }, data: { name: 'Someone else', phone: '617000001', provider: 'HORMUUD', registeredOn: '2024-01-01' } });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Gal Akoonka' }).click();
  await page.locator('#phone-number').fill(phone);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /^Fur Toosh/ }).click();
  await expect(page.getByTestId('fin-income')).toBeVisible();

  await page.goto('/#/dejinta');
  await page.locator('#simCardsBtn').click();
  await expect(page.getByText('Weli SIM Card ma jiro')).toBeVisible();
  await expect(page.getByText('Someone else')).toHaveCount(0);

  const add = async (name: string, num: string, provider: string, notes = '') => {
    await page.locator('#addSimBtn').click();
    await page.locator('#sim-name').fill(name);
    await page.locator('#sim-phone').fill(num);
    await page.getByRole('dialog').getByRole('radio', { name: provider }).click();
    if (notes) await page.locator('#sim-notes').fill(notes);
    await page.locator('#saveSimBtn').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await page.locator('#addSimBtn').click();
  await page.locator('#saveSimBtn').click();
  await expect(page.getByText('Geli magaca SIM-ka.')).toBeVisible();
  await page.keyboard.press('Escape');

  await add('SIM-ka shaqada', '61 512 3456', 'Hormuud', 'Slot 1');
  await add('Golis Garowe', '90 777 1234', 'Golis');
  await add('Somtel guriga', '65 222 3344', 'Somtel');
  await expect(page.getByTestId('sim-count')).toHaveText('3 SIM Card');
  await expect(page.getByText('+252 90 777 1234')).toBeVisible();

  // Duplicate number is refused.
  await page.locator('#addSimBtn').click();
  await page.locator('#sim-name').fill('Copy');
  await page.locator('#sim-phone').fill('615123456');
  await page.locator('#saveSimBtn').click();
  await expect(page.getByText('Lambarkan horay ayaa loo diiwaangeliyay.')).toBeVisible();
  await page.keyboard.press('Escape');

  // Search and filter.
  await page.getByRole('searchbox', { name: 'Raadi SIM Card' }).fill('guriga');
  await expect(page.getByTestId('sim-count')).toHaveText('1 ka mid ah 3 SIM Card');
  await page.getByRole('searchbox', { name: 'Raadi SIM Card' }).fill('');
  await page.getByRole('button', { name: 'Golis', exact: true }).click();
  await expect(page.getByText('Golis Garowe')).toBeVisible();
  await expect(page.getByText('SIM-ka shaqada')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dhammaan', exact: true }).click();

  // Edit.
  await page.getByRole('button', { name: 'Wax ka beddel SIM-ka shaqada' }).click();
  await page.locator('#sim-name').fill('SIM-ka xafiiska');
  await page.locator('#saveSimBtn').click();
  await expect(page.getByText('SIM-ka xafiiska', { exact: true })).toBeVisible();

  // Delete: cancel keeps it; confirm removes only it and shows a success message.
  await page.getByRole('button', { name: 'Tirtir Somtel guriga' }).click();
  await expect(page.getByText('SIM-ka dhabta ah, lambarka iyo adeegga shirkadda ma xirmayaan')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Jooji' }).click();
  await expect(page.getByText('Somtel guriga')).toBeVisible();
  await page.getByRole('button', { name: 'Tirtir Somtel guriga' }).click();
  await page.locator('#confirmDeleteSimBtn').click();
  await expect(page.getByTestId('sim-toast')).toContainText('SIM Card-ka "Somtel guriga" waa la tirtiray.');
  await expect(page.getByText('Somtel guriga')).toHaveCount(0);
  await expect(page.getByTestId('sim-count')).toHaveText('2 SIM Card');

  // The other account's record and this account's EVC number are untouched.
  const others = await (await request.get('/api/v1/sim-cards', { headers: { authorization: `Bearer ${otherReg.token}` } })).json();
  expect(others.total).toBe(1);
  const me = await (await request.get('/api/v1/me', { headers: { authorization: `Bearer ${reg.token}` } })).json();
  expect(me.evcNumbers).toHaveLength(1);
});
