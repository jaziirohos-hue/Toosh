/**
 * End-to-end in a real browser: expenses, budgets, goals, EVC payment categories, hiding amounts, the app PIN,
 * password change, recovery codes, language and theme. The source phone is simulated over HTTP (see flow.spec.ts).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const tz = 'Africa/Mogadishu';
const evcTime = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
};

async function account(request: APIRequestContext) {
  const phone = `61${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const reg = await (await request.post('/api/v1/auth/register', { data: { displayName: 'Faadumo Cali', phone, password: PASSWORD, device: { platform: 'android', name: 'A54' } } })).json();
  const auth = { authorization: `Bearer ${reg.token}` };
  const numberId = reg.evcNumbers[0].id;
  await request.post(`/api/v1/evc-numbers/${numberId}/source`, { headers: auth, data: { simSubscriptionId: 1, simSlot: 0, simLabel: 'SIM 1' } });
  const at = new Date(Date.now() - 5 * 60000);
  const r = await (await request.post('/api/v1/ingest/messages', { headers: auth, data: { messages: [
    { clientMessageId: `fin-${Date.now()}-1`, evcNumberId: numberId, sender: '192', body: `[-EVCPLUS-] waxaad $100 ka heshay 615223344, Tar: ${evcTime(at)} haraagagu waa $150.`, smsTimestamp: at.toISOString(), receivedAt: at.toISOString(), simSubscriptionId: 1, simSlot: 0, importMethod: 'LIVE', partsCount: 1 },
    { clientMessageId: `fin-${Date.now()}-2`, evcNumberId: numberId, sender: '192', body: `[-EVCPlus-] $20 ayaad uwareejisay Dukaanka Hodan(615551288), Tar: ${evcTime(new Date(at.getTime() + 60000))} Haraagaagu waa $130.`, smsTimestamp: at.toISOString(), receivedAt: at.toISOString(), simSubscriptionId: 1, simSlot: 0, importMethod: 'LIVE', partsCount: 1 },
  ] } })).json();
  return { phone, outId: r.results[1].messageId as string };
}

async function signIn(page: Page, phone: string, password = PASSWORD) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Gal Akoonka' }).click();
  await page.locator('#phone-number').fill(phone);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /^Fur Toosh/ }).click();
  await expect(page.getByTestId('fin-income')).toBeVisible();
}

test('expenses: add, edit, search, delete; EVC payment category; budget and goal', async ({ page, request }) => {
  const { phone, outId } = await account(request);
  await signIn(page, phone);
  await expect(page.getByTestId('fin-income')).toHaveText('+$100.00');
  await expect(page.getByTestId('fin-expenses')).toHaveText('-$20.00');

  await page.goto('/#/qarash');
  await expect(page.getByText('Maamul Qarashaadkaaga Si Fudud.')).toBeVisible();
  await page.locator('#addExpenseBtn').click();
  await page.locator('#saveExpenseBtn').click();
  await expect(page.getByText('Geli magaca qarashka.')).toBeVisible();
  await page.locator('#expense-name').fill('Biilka korontada');
  await page.locator('#expense-amount').fill('12.5');
  await page.getByRole('button', { name: 'Korantada', exact: true }).click();
  await page.locator('#saveExpenseBtn').click();
  await expect(page.getByTestId('spent-USD')).toHaveText('$32.50');
  await expect(page.getByText('Biilka korontada')).toBeVisible();

  // Edit: make it unpaid and in SOS.
  await page.getByText('Biilka korontada').click();
  await page.locator('#expense-amount').fill('25000');
  await page.getByRole('radio', { name: 'SOS' }).click();
  await page.getByRole('radio', { name: 'Lama bixin' }).click();
  await page.locator('#saveExpenseBtn').click();
  await expect(page.getByTestId('spent-USD')).toHaveText('$20.00');
  await expect(page.getByText('Aan la bixin: SOS 25,000')).toBeVisible();

  // Search.
  await page.getByRole('searchbox', { name: 'Raadi qarash' }).fill('korontada');
  await expect(page.getByText('Dukaanka Hodan')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Raadi qarash' }).fill('');
  await expect(page.getByText('Dukaanka Hodan')).toBeVisible();

  // Categorise the EVC payment from the expense list.
  await page.getByText('Dukaanka Hodan').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cuntada', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kaydi', exact: true }).click();
  await expect(page.locator('main').getByText('Cuntada').first()).toBeVisible();
  // …and it shows on the SMS detail screen.
  await page.goto(`/#/fariin/${outId}`);
  await expect(page.locator('#txCategoryBtn')).toContainText('Cuntada');

  // Delete the manual expense.
  await page.goto('/#/qarash');
  await page.getByText('Biilka korontada').click();
  await page.getByRole('button', { name: 'Tirtir qarashka' }).click();
  await page.getByRole('button', { name: 'Tirtir', exact: true }).click();
  await expect(page.getByText('Biilka korontada')).toHaveCount(0);

  // Budget over its limit → alert.
  await page.getByRole('radio', { name: 'Miisaaniyad' }).click();
  await page.locator('#addBudgetBtn').click();
  await page.locator('#budget-amount').fill('15');
  await page.locator('#saveBudgetBtn').click();
  await expect(page.getByText(/waa la dhaafay: \$20\.00 \/ \$15\.00/)).toBeVisible();

  // Savings goal with money added.
  await page.getByRole('radio', { name: 'Hadafyo' }).click();
  await page.locator('#addGoalBtn').click();
  await page.locator('#goal-name').fill('Gaari');
  await page.locator('#goal-target').fill('1000');
  await page.locator('#saveGoalBtn').click();
  await page.getByRole('button', { name: 'Ku dar lacag' }).click();
  await page.getByRole('dialog').locator('input').fill('250');
  await page.getByRole('dialog').getByRole('button', { name: 'Ku dar', exact: true }).click();
  await expect(page.getByText('25%')).toBeVisible();
});

test('hide amounts, language, theme', async ({ page, request }) => {
  const { phone } = await account(request);
  await signIn(page, phone);
  await expect(page.getByTestId('balance')).toHaveText('$130.00');
  await page.getByRole('button', { name: 'Qari lacagta' }).click();
  await expect(page.getByTestId('balance')).toHaveText('******');
  await expect(page.getByTestId('fin-income')).toHaveText('******');
  await page.reload();
  await expect(page.getByTestId('balance')).toHaveText('******');
  await page.getByRole('button', { name: 'Muuji lacagta' }).click();
  await expect(page.getByTestId('balance')).toHaveText('$130.00');

  await page.goto('/#/dejinta');
  await page.locator('#languageBtn').click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.locator('#themeBtn').click();
  await page.getByRole('button', { name: 'Dark' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await expect(page.getByRole('link', { name: 'Expenses' })).toBeVisible();
});

test('app PIN: set, lock on open, wrong PIN refused, unlock, turn off', async ({ page, request }) => {
  const { phone } = await account(request);
  await signIn(page, phone);
  await page.goto('/#/dejinta');
  await page.getByRole('switch', { name: 'PIN-ka app-ka' }).click();
  await page.locator('#pin-input').fill('1111');
  await page.locator('#pinNextBtn').click();
  await expect(page.getByText('Dooro PIN aan fududeyn')).toBeVisible();
  await page.locator('#pin-input').fill('4826');
  await page.locator('#pinNextBtn').click();
  await page.locator('#pin-input').fill('4826');
  await page.locator('#pinNextBtn').click();
  await expect(page.getByRole('switch', { name: 'PIN-ka app-ka' })).toHaveAttribute('aria-checked', 'true');
  const stored = await page.evaluate(() => localStorage.getItem('toosh.pin') ?? '');
  expect(stored).not.toContain('4826');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Geli PIN-ka Toosh' })).toBeVisible();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByText('PIN-ku waa khalad')).toBeVisible();
  for (const d of '4826') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dejinta' })).toBeVisible();

  await page.getByRole('switch', { name: 'PIN-ka app-ka' }).click();
  await page.locator('#pin-off-input').fill('4826');
  await page.getByRole('button', { name: 'Dami', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'PIN-ka app-ka' })).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dejinta' })).toBeVisible();
});

test('change password, recovery codes, forgot password', async ({ page, request }) => {
  const { phone } = await account(request);
  await signIn(page, phone);
  await page.goto('/#/dejinta');
  await page.locator('#changePasswordBtn').click();
  await page.locator('#current-password').fill('wrong password');
  await page.locator('#new-password').fill('a new long secret');
  await page.locator('#confirm-password').fill('a new long secret');
  await page.locator('#savePasswordBtn').click();
  await expect(page.getByText('Furaha sirta ah ee hadda waa khalad.')).toBeVisible();
  await page.locator('#current-password').fill(PASSWORD);
  await page.locator('#savePasswordBtn').click();
  await expect(page.getByText(/Furaha (sirta )?waa la beddelay/)).toBeVisible();

  await page.locator('#recoveryCodesBtn').click();
  await page.locator('#codes-password').fill('a new long secret');
  await page.locator('#generateCodesBtn').click();
  const codes = (await page.getByTestId('recovery-codes').innerText()).split(/\s+/).filter(Boolean);
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'Waan kaydiyay' }).click();

  await page.locator('#signOutBtn').click();
  await page.getByRole('button', { name: 'Ka bax', exact: true }).click();
  await page.getByRole('tab', { name: 'Gal Akoonka' }).click();
  await page.locator('#forgotPasswordBtn').click();
  await page.locator('#phone-number').fill(phone);
  await page.locator('#recovery-code').fill(codes[0]);
  await page.locator('#new-password').fill('recovered secret 9');
  await page.getByRole('button', { name: /Beddel furaha oo gal/ }).click();
  await expect(page.getByTestId('fin-income')).toBeVisible();
  const login = await request.post('/api/v1/auth/login', { data: { phone, password: 'recovered secret 9' } });
  expect(login.status()).toBe(200);
});
