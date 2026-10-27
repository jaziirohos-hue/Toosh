/**
 * Layout at the phone's normal and largest supported font size: no text may spill out of buttons, boxes or the
 * screen, and nothing may be cut off with "…". On Android the app follows the system font size by scaling the
 * whole screen up to 130% (app/src/main.tsx); here that is reproduced with the same CSS zoom.
 */
import { expect, test, type Page } from '@playwright/test';
import { useSomali } from './somali.ts';
import { auditLayout } from './layout-audit.ts';

const PASSWORD = 'layout test password';

async function seed(request: import('@playwright/test').APIRequestContext) {
  const phone = `61${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const reg = await (await request.post('/api/v1/auth/register', { data: { displayName: 'Maxamed Cabdiraxmaan Xasan Cali', phone, password: PASSWORD, device: { platform: 'android', name: 'Samsung Galaxy A14 5G', model: 'SM-A145F' } } })).json();
  const auth = { authorization: `Bearer ${reg.token}` };
  const numberId = reg.evcNumbers[0].id;
  await request.post(`/api/v1/evc-numbers/${numberId}/source`, { headers: auth, data: { simSubscriptionId: 1, simSlot: 0, simLabel: 'SIM 1 · Hormuud' } });
  const at = (m: number) => new Date(Date.now() - m * 60000);
  const tar = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Mogadishu', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d).replace(',', '');
  const sms = (body: string, m: number, i: number) => ({ clientMessageId: `layout-${Date.now()}-${i}`, evcNumberId: numberId, sender: '192', body, smsTimestamp: at(m).toISOString(), receivedAt: at(m).toISOString(), simSubscriptionId: 1, simSlot: 0, importMethod: 'LIVE', partsCount: 1 });
  await request.post('/api/v1/ingest/messages', { headers: auth, data: { messages: [
    sms(`[-EVCPLUS-] waxaad $1250.75 ka heshay Cabdiraxmaan Maxamed Xuseen (615223344), Tar: ${tar(at(30))} haraagagu waa $12345.50.`, 30, 1),
    sms(`[-EVCPlus-] $3.90 ayaad uwareejisay Axmed Nuur(615551288), Tar: ${tar(at(20))} Haraagaagu waa $12341.60.`, 20, 2),
    sms(`[-EVCPlus-] $7.00 waxaad u dirtay 615998822 Tariikh: ${tar(at(10))}.`, 10, 3),
  ] } });
  const today = new Date().toISOString().slice(0, 10);
  await request.post('/api/v1/expenses', { headers: auth, data: { name: 'Fiiska iskuulka carruurta ee bisha', amount: '125.50', currency: 'USD', category: 'iskuulka', spentOn: today, paymentStatus: 'UNPAID', description: 'Labada wiil' } });
  await request.post('/api/v1/expenses', { headers: auth, data: { name: 'Khudaar iyo hilib', amount: '1250000', currency: 'SOS', category: 'caafimaadka', spentOn: today, paymentStatus: 'PAID' } });
  await request.put('/api/v1/budgets', { headers: auth, data: { period: 'MONTHLY', amount: '5', currency: 'USD' } });
  await request.put('/api/v1/budgets', { headers: auth, data: { period: 'WEEKLY', category: 'gaari_raac', amount: '100', currency: 'USD' } });
  await request.post('/api/v1/sim-cards', { headers: auth, data: { name: 'SIM-ka labaad ee ganacsiga iyo qoyska', phone: '907771234', provider: 'GOLIS', registeredOn: '2023-05-01', notes: 'Waxaa la isticmaalaa marka la safrayo Garowe iyo Boosaaso' } });
  await request.post('/api/v1/goals', { headers: auth, data: { name: 'Gaari cusub oo qoyska loogu talagalay', target: '12000', saved: '3500', currency: 'USD', targetDate: '2027-06-30' } });
  return phone;
}

async function audit(page: Page, zoom: number, name: string) {
  await page.evaluate(z => { document.documentElement.style.zoom = String(z); document.documentElement.style.setProperty('--app-zoom', String(z)); }, zoom);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const issues = await page.evaluate(auditLayout);
  expect(issues, `${name} at ${Math.round(zoom * 100)}%`).toEqual([]);
}

// Phone widths: 412 (Playwright's Pixel 7), and a narrow 320-wide phone, each at normal and the largest font size.
for (const lang of ['en', 'so'] as const) for (const [width, zoom] of [[412, 1], [412, 1.3], [320, 1], [320, 1.3]] as const) {
  test(`no text spills or is cut off on a ${width}px phone at ${Math.round(zoom * 100)}% font size (${lang === 'en' ? 'English' : 'Somali'})`, async ({ page, request }) => {
    if (lang === 'so') await useSomali(page);
    await page.setViewportSize({ width, height: 800 });
    const phone = await seed(request);
    await page.goto('/');
    await audit(page, zoom, 'register');
    await page.getByRole('tab', { name: /^(Gal Akoonka|Sign in)$/ }).click();
    await audit(page, zoom, 'login');
    await page.locator('#phone-number').fill(phone);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: /^(Fur|Open) Toosh/ }).click();
    await expect(page.getByTestId('total-in')).toBeVisible();
    for (const route of ['guud', 'fariimaha', 'qarash', 'qarash/miisaaniyad', 'qarash/hadaf', 'dhaqdhaqaaq', 'dejinta', 'sim-card']) {
      await page.goto(`/#/${route}`);
      await audit(page, zoom, route);
    }
    await page.goto('/#/qarash');
    await page.locator('#addExpenseBtn').click();
    await audit(page, zoom, 'expense form');
    await page.keyboard.press('Escape');
    await page.goto('/#/sim-card');
    await page.locator('#addSimBtn').click();
    await audit(page, zoom, 'SIM card form');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^(Tirtir|Delete) / }).first().click();
    await audit(page, zoom, 'SIM delete confirmation');
    await page.keyboard.press('Escape');
    await page.goto('/#/fariimaha/pending');
    await page.getByRole('button', { name: /^(Kala Saar Hadda|Review now)$/ }).first().click();
    await expect(page.getByTestId('original-sms')).toBeVisible();
    await audit(page, zoom, 'message detail');
  });
}
