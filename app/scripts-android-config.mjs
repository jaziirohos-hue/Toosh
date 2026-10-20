// Prepares the Android project for the API address in VITE_API_BASE (run by `npm run android -w app`).
// - Debug builds may use plain HTTP to a development server: the host is added to the DEBUG-ONLY network
//   security config. Release builds keep their HTTPS-only config (src/main/res/xml/network_security_config.xml).
// - Refuses an http:// address that is not a local/LAN/emulator host.
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.env.VITE_API_BASE ?? '';
if (!base) { console.error('Set VITE_API_BASE, e.g. VITE_API_BASE=http://10.0.2.2:8787 for the Android emulator.'); process.exit(1); }
let url;
try { url = new URL(base); } catch { console.error(`VITE_API_BASE is not a valid URL: ${base}`); process.exit(1); }
if (url.protocol === 'http:') {
  const h = url.hostname;
  const local = h === 'localhost' || h === '10.0.2.2' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
  if (!local) { console.error(`Plain HTTP is only allowed for local development hosts, not ${h}. Use https://.`); process.exit(1); }
  const file = 'android/app/src/debug/res/xml/network_security_config.xml';
  const xml = readFileSync(file, 'utf8');
  if (!xml.includes(`>${h}</domain>`)) {
    writeFileSync(file, xml.replace('    </domain-config>', `        <domain includeSubdomains="false">${h}</domain>\n    </domain-config>`));
    console.log(`Debug builds: allowed plain HTTP to ${h} (release builds are unaffected).`);
  }
}
console.log(`Android app will use the API at ${url.origin}`);
