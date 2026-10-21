/**
 * Real Android check of the layout at a large phone font size. Sets the emulator's font size to 130%, opens the
 * installed app, signs in through its WebView, and checks every screen for text that spills out of buttons,
 * boxes or the screen, or is cut off with "…". Screenshots are saved for review.
 * Usage (from the repo root, emulator running, API on :8787): npx tsx app/android/scripts/webview-layout.ts <outDir>
 */
import { execFileSync } from 'node:child_process';
import { _android as android } from 'playwright';
import { auditLayout } from '../../../e2e/layout-audit.ts';

const out = process.argv[2] ?? 'app/android/build/e2e';
const PKG = 'so.toosh.app';
const API = 'http://localhost:8787';
const PASSWORD = 'webview layout password';
const adb = (...args: string[]) => execFileSync('adb', args, { stdio: ['ignore', 'pipe', 'inherit'] });

async function api(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

// An account whose source phone is already bound, with a few EVC Plus messages, so every screen has content.
const phone = `61${String(Date.now()).slice(-7)}`;
const reg = await api('POST', '/api/v1/auth/register', undefined, { displayName: 'Maxamed Cabdiraxmaan Xasan Cali', phone, password: PASSWORD, device: { platform: 'android', name: 'Layout source', model: 'SM-A145F' } });
const numberId = reg.evcNumbers[0].id;
await api('POST', `/api/v1/evc-numbers/${numberId}/source`, reg.token, { simSubscriptionId: 1, simSlot: 0, simLabel: 'SIM 1 · Hormuud' });
const now = Date.now();
const sms = (body: string, i: number) => ({ clientMessageId: `wv-${now}-${i}`, evcNumberId: numberId, sender: '192', body, smsTimestamp: new Date(now - i * 60000).toISOString(), receivedAt: new Date(now - i * 60000).toISOString(), simSubscriptionId: 1, simSlot: 0, importMethod: 'LIVE', partsCount: 1 });
await api('POST', '/api/v1/ingest/messages', reg.token, { messages: [
  sms('[-EVCPLUS-] waxaad $1250.75 ka heshay Cabdiraxmaan Maxamed Xuseen (615223344), Tar: 21/10/26 08:00:00 haraagagu waa $12345.50.', 3),
  sms('[-EVCPlus-] $3.90 ayaad uwareejisay Axmed Nuur(615551288), Tar: 21/10/26 08:10:00 Haraagaagu waa $12341.60.', 2),
  sms('[-EVCPlus-] $7.00 waxaad u dirtay 615998822 Tariikh: 21/10/26 08:20:00.', 1),
] });

adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3');
adb('shell', 'am', 'force-stop', PKG);
adb('shell', 'pm', 'clear', PKG); // fresh app data: start signed out
for (const p of ['RECEIVE_SMS', 'READ_SMS', 'READ_PHONE_STATE', 'POST_NOTIFICATIONS']) { try { adb('shell', 'pm', 'grant', PKG, `android.permission.${p}`); } catch { /* not requested on this API level */ } }
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);

const [device] = await android.devices({ omitDriverInstall: true });
const webview = await device.webView({ pkg: PKG });
const page = await webview.page();
await page.locator('#phone-number').waitFor({ timeout: 60000 });

const failures: string[] = [];
const zoom = await page.evaluate(() => document.documentElement.style.zoom);
console.log(`font_scale 1.3 -> app zoom ${zoom || '(none)'}`);
if (zoom !== '1.3') failures.push(`expected the app to scale to 1.3 at font size 130%, got "${zoom}"`);

const shot = (name: string) => execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 });
const { writeFileSync } = await import('node:fs');
async function check(name: string) {
  await page.waitForTimeout(1200);
  const issues = await page.evaluate(auditLayout);
  writeFileSync(`${out}/font130-${name}.png`, shot(name));
  console.log(`${name}: ${issues.length ? issues.join(' | ') : 'OK'}`);
  failures.push(...issues.map(i => `${name}: ${i}`));
}

await check('register');
await page.getByRole('tab', { name: 'Gal Akoonka' }).click();
await check('login');
await page.locator('#phone-number').fill(phone);
await page.locator('#password').fill(PASSWORD);
await page.getByRole('button', { name: /^Fur Toosh/ }).click();
await page.getByTestId('total-in').waitFor({ timeout: 30000 });
for (const route of ['guud', 'fariimaha', 'dhaqdhaqaaq', 'dejinta']) {
  await page.evaluate(r => { window.location.hash = `#/${r}`; }, route);
  await check(route);
}
await page.evaluate(() => { window.location.hash = '#/fariimaha/pending'; });
await page.getByRole('button', { name: 'Kala Saar Hadda' }).first().click();
await page.getByTestId('original-sms').waitFor();
await check('message-detail');

adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
await device.close();
if (failures.length) { console.error(`\n${failures.length} layout problem(s) at font size 130%:\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('Real Android WebView at font size 130%: no text spills or is cut off.');
