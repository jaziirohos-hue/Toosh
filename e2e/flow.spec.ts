/**
 * End-to-end: source phone -> server -> viewing device -> manual correction -> history and totals.
 *
 * The "source phone" here is SIMULATED: this test sends the exact HTTP requests the Android uploader sends
 * (POST /api/v1/ingest/messages with a source-device token). Real SMS capture on Android is verified separately by
 * the emulator tests in android/ (see README). The viewing device is a real browser running the real app.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { useSomali } from './somali.ts';

test.beforeEach(async ({ page }) => { await useSomali(page); });

const PASSWORD = 'correct horse battery';
const tz = 'Africa/Mogadishu';

/** "dd/mm/yy HH:MM:SS" in Mogadishu time, as EVC Plus writes it. */
function evcTime(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
/** A time earlier today in Mogadishu (falls back to "now" right after midnight). */
function todayAt(minutesAgo: number) {
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now).split(':').map(Number);
  const sinceMidnight = local[0] * 60 + local[1];
  return new Date(now.getTime() - Math.min(minutesAgo, Math.max(sinceMidnight - 1, 0)) * 60000);
}

async function simulatedSourcePhone(request: APIRequestContext) {
  const phone = `61${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const reg = await request.post('/api/v1/auth/register', { data: { displayName: 'Axmed Nuur Cali', phone, password: PASSWORD, device: { platform: 'android', name: 'Samsung Galaxy A54', model: 'SM-A546E' } } });
  expect(reg.status()).toBe(201);
  const body = await reg.json();
  const token = body.token as string;
  const numberId = body.evcNumbers[0].id as string;
  const bind = await request.post(`/api/v1/evc-numbers/${numberId}/source`, { headers: { authorization: `Bearer ${token}` }, data: { simSubscriptionId: 1, simSlot: 0, simLabel: 'SIM 1 · Hormuud' } });
  expect(bind.status()).toBe(200);
  let n = 0;
  const upload = async (text: string, at: Date) => {
    const res = await request.post('/api/v1/ingest/messages', { headers: { authorization: `Bearer ${token}` }, data: { messages: [{
      clientMessageId: `e2e-${at.getTime()}-${n++}`, evcNumberId: numberId, sender: '192', body: text,
      smsTimestamp: at.toISOString(), receivedAt: new Date(at.getTime() + 1500).toISOString(), simSubscriptionId: 1, simSlot: 0, importMethod: 'LIVE', partsCount: 1 }] } });
    expect(res.status()).toBe(200);
    return (await res.json()).results[0];
  };
  return { phone, upload };
}

test('SMS -> stored -> classified or queued -> synced -> shown -> corrected -> totals and history update', async ({ page, request }) => {
  const src = await simulatedSourcePhone(request);
  const t1 = todayAt(180), t2 = todayAt(120), t3 = todayAt(60);
  expect((await src.upload(`[-EVCPlus-] $3.90 ayaad uwareejisay Qof Tusaale(615551288), Tar: ${evcTime(t1)} Haraagaagu waa $51.59.`, t1)).classification).toBe('TRANSACTION');
  expect((await src.upload(`[-EVCPLUS-] waxaad $3 ka heshay 615998822, Tar: ${evcTime(t2)} haraagagu waa $54.585.`, t2)).classification).toBe('TRANSACTION');
  expect((await src.upload(`[-EVCPlus-] $15.00 waxaad u dirtay 615998822 Tariikh: ${evcTime(t3)}. Haraagaagu waa $39.585.`, t3)).classification).toBe('PENDING');

  // Viewing device signs in.
  await page.goto('/');
  await page.getByRole('tab', { name: 'Gal Akoonka' }).click();
  await page.locator('#phone-number').fill(src.phone);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /^Fur Toosh/ }).click();

  await expect(page.getByTestId('total-in')).toHaveText('+$3.00');
  await expect(page.getByTestId('total-out')).toHaveText('-$3.90');
  await expect(page.getByTestId('balance')).toHaveText('$54.585'); // newest eligible balance; the pending one is ignored
  await expect(page.getByText('1 Fariimood waxay u baahan yihiin kala saarid')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Isku xiran' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/guud.png', fullPage: true });

  // Pending message -> manual classification.
  await page.getByRole('button', { name: /Kala saar hadda/ }).click();
  await expect(page.getByTestId('pending-card')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/screens/fariimaha.png', fullPage: true });
  await page.getByRole('button', { name: 'Kala Saar Hadda' }).click();
  await expect(page.getByTestId('original-sms')).toContainText('waxaad u dirtay');
  await page.getByRole('radio', { name: /Baxay/ }).click();
  await expect(page.locator('#tx-amount')).toHaveValue('15.00');
  await page.locator('#tx-name').fill('Faarax Axmed Geedi');
  await page.screenshot({ path: 'test-results/screens/kala-saar.png', fullPage: true });
  await page.getByRole('button', { name: 'Kaydi Dhaqdhaqaaqa' }).click();
  await expect(page).not.toHaveURL(/#\/fariin\//);

  // Totals now include the corrected transaction; the newer balance (39.585) becomes eligible.
  await page.goto('/#/guud');
  await expect(page.getByTestId('total-out')).toHaveText('-$18.90');
  await expect(page.getByTestId('balance')).toHaveText('$39.585');
  await expect(page.getByText(/Fariimood waxay u baahan yihiin kala saarid/)).toHaveCount(0);

  // Live sync: a new SMS on the source phone appears without reloading (instantly with the live stream, within
  // about 8 s on serverless hosting where the app checks for changes on a timer).
  const t4 = new Date();
  await src.upload(`[-EVCPLUS-] waxaad $10 ka heshay Sahra Maxamed (615443312), Tar: ${evcTime(t4)} haraagagu waa $49.585.`, t4);
  await expect(page.getByTestId('total-in')).toHaveText('+$13.00', { timeout: 20000 });
  await expect(page.getByTestId('balance')).toHaveText('$49.585');

  // History: search and the manual badge.
  await page.getByRole('link', { name: 'Taariikh' }).click();
  await expect(page.getByTestId('history-out')).toHaveText('-$18.90');
  await page.getByRole('searchbox', { name: 'Raadi dhaqdhaqaaq' }).fill('Faarax');
  await expect(page.getByText('Gacanta lagu saxay')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Raadi dhaqdhaqaaq' }).fill('');
  await expect(page.getByRole('button', { name: /Sahra Maxamed/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/dhaqdhaqaaq.png', fullPage: true });

  // Reclassify as "not a transaction": totals drop, the message is kept, the audit trail records both changes.
  await page.getByRole('button', { name: /Faarax Axmed Geedi/ }).click();
  await page.getByRole('radio', { name: /Ma aha transaction/ }).click();
  await page.getByRole('button', { name: 'Kaydi Dhaqdhaqaaqa' }).click();
  await expect(page).not.toHaveURL(/#\/fariin\//);
  await page.goto('/#/guud');
  await expect(page.getByTestId('total-out')).toHaveText('-$3.90');
  await page.goto('/#/fariimaha/ignored');
  await expect(page.getByText('waxaad u dirtay')).toBeVisible();
  await page.getByRole('button', { name: 'Wax ka beddel' }).first().click();
  await page.getByRole('button', { name: /Taariikhda isbeddelka/ }).click();
  await expect(page.getByText(/La kala saaray · v3/)).toBeVisible();
  await expect(page.getByText(/Kahor: Transaction \$15.00/)).toBeVisible();

  await page.goto('/#/dejinta');
  await expect(page.getByText('Diiwaangashan')).toBeVisible();
  await expect(page.getByText('Lama xaqiijin').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/dejinta.png', fullPage: true });
});

test('two devices editing the same message get a visible conflict, not a silent overwrite', async ({ browser, request }) => {
  const src = await simulatedSourcePhone(request);
  const t = todayAt(30);
  const r = await src.upload(`[-EVCPlus-] $7.00 waxaad u dirtay 615998822 Tariikh: ${evcTime(t)}.`, t);
  const login = async () => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await useSomali(p);
    await p.goto('/');
    await p.getByRole('tab', { name: 'Gal Akoonka' }).click();
    await p.locator('#phone-number').fill(src.phone);
    await p.locator('#password').fill(PASSWORD);
    await p.getByRole('button', { name: /^Fur Toosh/ }).click();
    await expect(p.getByTestId('total-in')).toBeVisible();
    await p.goto(`/#/fariin/${r.messageId}`);
    await expect(p.getByTestId('original-sms')).toBeVisible();
    return p;
  };
  const a = await login(); const b = await login();
  // B starts editing first, so B's form is based on the version before A's change (a form that has not been
  // touched yet simply refreshes to the newest version, which is not a conflict).
  await b.getByRole('radio', { name: /Soo galay/ }).click();
  await a.getByRole('radio', { name: /Baxay/ }).click();
  await a.getByRole('button', { name: 'Kaydi Dhaqdhaqaaqa' }).click();
  await expect(a).toHaveURL(/#\/(fariimaha|guud)/);

  await b.getByRole('button', { name: 'Kaydi Dhaqdhaqaaqa' }).click();
  await expect(b.getByRole('region', { name: 'Isku dhac' })).toBeVisible();
  await expect(b.getByText('Aalad kale ayaa beddeshay fariintan')).toBeVisible();
  await b.screenshot({ path: 'test-results/screens/conflict.png', fullPage: true });
  await b.getByRole('button', { name: 'Hayso kooda' }).click();
  await expect(b.getByRole('region', { name: 'Isku dhac' })).toHaveCount(0);
  await expect(b.getByRole('radio', { name: /Baxay/ })).toHaveAttribute('aria-checked', 'true');
});

test('a viewing device can be revoked and is signed out', async ({ browser, request }) => {
  const src = await simulatedSourcePhone(request);
  const ctx = await browser.newContext(); const p = await ctx.newPage(); await useSomali(p);
  await p.goto('/');
  await p.getByRole('tab', { name: 'Gal Akoonka' }).click();
  await p.locator('#phone-number').fill(src.phone);
  await p.locator('#password').fill(PASSWORD);
  await p.getByRole('button', { name: /^Fur Toosh/ }).click();
  await expect(p.getByTestId('total-in')).toBeVisible();
  // The owner revokes this browser from another device (here: via the source phone's session).
  const owner = await request.post('/api/v1/auth/login', { data: { phone: src.phone, password: PASSWORD, device: { platform: 'android', name: 'Owner' } } });
  const token = (await owner.json()).token;
  const me = await (await request.get('/api/v1/me', { headers: { authorization: `Bearer ${token}` } })).json();
  const browserDevice = me.devices.find((d: any) => d.platform === 'web');
  expect((await request.delete(`/api/v1/devices/${browserDevice.id}`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(200);
  await p.reload();
  await expect(p.getByRole('tab', { name: 'Gal Akoonka' })).toBeVisible();
});
