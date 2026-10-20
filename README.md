# Toosh

Toosh tracks **EVC Plus money received, money sent and the latest SMS-reported balance**.

- The **source phone** is an Android phone with the EVC Plus SIM. Toosh captures the EVC Plus SMS it receives,
  keeps them in an encrypted on-phone queue and uploads them.
- **Viewing devices** (another phone, a browser) sign in to the same account to watch synchronized activity and
  sort the messages Toosh could not classify on its own.

Registering a number does **not** fetch its transactions, and Toosh never marks a number as verified. Data comes only
from an authorized source phone. Toosh never asks for, or stores, the EVC Plus PIN.

The UI follows the Stitch designs in `design/stitch/` (kept unchanged as the reference).

## Architecture

| Part | Where | What |
| --- | --- | --- |
| Shared rules | `shared/` | EVC Plus SMS parser, fixed-point money (thousandths, `bigint`), Somali number formatting, classification validation, account-timezone periods. Used by both the server and the app. |
| Backend | `server/` | Node 22 + Fastify + PostgreSQL. Accounts, devices, EVC numbers, idempotent SMS ingest, versioned manual classification with an audit log, totals, balances, live change events. |
| App | `app/` | React + Tailwind port of the Stitch screens. Runs in the browser (served by the API) and inside the Android app (Capacitor). |
| Native Android | `app/android/app/src/main/java/so/toosh/app/` | SMS receiver, multipart assembly, EVC filter, SIM routing, Keystore-encrypted SQLite queue, WorkManager uploads, inbox import, masked notifications, biometric/PIN lock. |

**Why this backend:** the design needs accounts shared across devices, server-side isolation between accounts, atomic
edits with history, and exact money arithmetic. PostgreSQL gives transactions, row-level security, `bigint` money and
partial unique indexes, and runs on any managed Postgres (Neon, Supabase, RDS, Render, Railway). Fastify is a small,
fast Node server that shares the TypeScript parser with the app.

### How data flows

1. **SMS arrives on the source phone.** `SmsReceiver` (declared in the manifest, so it runs with the UI closed) joins
   multipart parts and drops anything that is not EVC Plus. It finds the receiving SIM and writes the original text,
   sender, network timestamp, receipt time, SIM subscription/slot and import identity to the encrypted queue. All of
   this happens **before** any upload.
2. **Upload.** WorkManager runs whenever there is a network. Uploads go oldest first, 50 at a time, with exponential
   backoff, and survive reboots and process death. Each SMS keeps the identity it was stored with, so retries and
   re-imports are idempotent.
3. **Server stores and classifies.** `POST /api/v1/ingest/messages` accepts messages only from the number's source
   phone, on its SIM. It dedupes on (number, sender, network timestamp, exact text), stores the original SMS
   permanently and runs the parser:
   - **Unambiguous transaction:** confirmed automatically.
   - **Balance-only SMS:** marked as not a transaction, balance kept.
   - **Anything else:** queued for review (`PENDING`).
   - **Provider reference already used by a confirmed transaction:** never confirmed twice; goes to review.
4. **Viewing devices update** through a server-sent event stream and refetch what they show. Out-of-order or
   repeated notifications are harmless.
5. **Manual classification** ("Soo galay", "Baxay", "Ma aha transaction") is a single atomic update:
   - It is checked against the record version; a stale version returns `409` with the current record, and the app
     shows a conflict screen.
   - The change, the previous values, the device and the time go into `message_changes`.
   - The original SMS can never change (database trigger).
   - Later parser runs never overwrite manual work.

### Parser rules (`shared/src/parser.ts`)

- **Direction only from wording:** `… ayaad uwareejisay …` = Baxay, `waxaad … ka heshay` = Soo galay. Spelling, spacing,
  capitals and line breaks are normalised. Both or neither means review. Balance changes are never used to guess direction.
- The **balance clause** (`Haraagaagu/haraagagu/Haraaga waa $…`) is removed before looking for the amount, so the
  balance is never read as the amount.
- **Exactly one USD amount**, at most three decimals (`$54.585` is kept exactly). Shilling amounts and several
  different amounts go to review.
- **Time:** `Tar:`/`Tariikh:` is read as `DD/MM/YY HH:MM:SS` in Somalia time. A time more than 3 days from the receipt
  time goes to review. With no time in the SMS, the receipt time is used and recorded as `RECEIPT_FALLBACK`.
- **Promotional links** are removed first. A provider reference (`Ref:`, `Tixraac:` …) is used when present.
- **Adding a format** means adding a rule and a test vector in `shared/test/parser.test.ts`, then running
  `npm run reprocess -w server -- --account <id>`.

### Totals and balance

- **Totals** sum only confirmed transactions (`TRANSACTION`) whose transaction time falls in the period. Periods are
  calendar days, Monday-start weeks and months in the account timezone (default `Africa/Mogadishu`).
- **Pending and "not a transaction" messages never count.**
- **"Haraagii ugu dambeeyay"** is the SMS-reported balance with the newest effective time among non-pending messages.
  Arrival order does not matter, so an older imported SMS never replaces a newer balance. It is shown separately from
  the totals; Toosh never treats "in minus out" as the balance and never invents an opening balance.

### Security and privacy

- **Account isolation:** every query filters by account, and PostgreSQL row-level security (`FORCE ROW LEVEL
  SECURITY`) enforces it again. A query that forgets its filter still sees nothing from other accounts. The server
  refuses to start in production as a superuser or `BYPASSRLS` role.
- **Passwords** use scrypt. Device tokens are random 256-bit values stored only as SHA-256 hashes.
- **Sessions:** browsers get an HttpOnly, SameSite=Strict cookie (never readable by page scripts), and cookie writes
  need a custom header. The Android app keeps its token encrypted with an Android Keystore key.
- **Revoking a device** signs it out immediately and unbinds it as a source.
- **Logs** never contain bodies, query strings, tokens or auth headers.
- **On the phone:** SMS text is encrypted at rest. Backups and device transfer exclude app data. Notifications never
  show amounts, names, numbers or SMS text, and are private on the lock screen. Release builds allow HTTPS only.
- **Sign-in protection:** per-IP rate limits, and an account lock after 10 wrong passwords (15 minutes).

## Run it

Requirements: Node 22, PostgreSQL 14+, and for Android: JDK 21 and the Android SDK (platform 36). Android Studio is
the easiest way to get the SDK.

```bash
npm ci
cp .env.example .env        # then edit DATABASE_URL etc.
```

### Database (once)

Use a normal role so row-level security applies:

```sql
CREATE ROLE toosh LOGIN PASSWORD 'choose-a-password' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE toosh OWNER toosh;
```

Migrations run automatically on server start (`MIGRATE_ON_START=true`), or explicitly with `npm run db:migrate`.

### Backend + browser app

```bash
npm run build                # builds app/dist
npm run start -w server      # API + browser app on http://localhost:8787 (WEB_DIST=../app/dist in .env)
```

For UI development with hot reload, run `npm run dev:server` and `npm run dev:app`, then open http://localhost:5173.
Vite proxies `/api` to the server.

### Android app

```bash
VITE_API_BASE=https://your-toosh-api.example.com npm run android:sync -w app
cd app/android && ./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
```

Or open `app/android` in Android Studio. For an emulator against a local API use
`VITE_API_BASE=http://10.0.2.2:8787`; debug builds allow this cleartext address and release builds do not.

**On the phone:**

1. Install the APK.
2. Create the account (or sign in).
3. Grant the SMS permission. The app explains why before Android asks.
4. On dual-SIM phones, choose which SIM holds the EVC number. Toosh will not guess.
5. Optionally import existing EVC Plus messages (7, 30 or 90 days).
6. Open Toosh once after installing or after a force-stop, and allow background activity if your phone's battery
   settings restrict it.

## Tests

```bash
npm test                # shared parser/money (19), API with real Postgres + RLS (19), app offline queue (4)
npm run typecheck
```

- **API tests:** need a local Postgres where `TEST_ADMIN_DATABASE_URL` (default `postgres://postgres@127.0.0.1:5432/postgres`)
  can create databases. Each run creates a throwaway database owned by a non-superuser role.
- **Browser end-to-end:** with the API running and serving `app/dist`, run `npx playwright test`.
- **Native tests:** `cd app/android && ./gradlew testDebugUnitTest` runs the JVM tests (relevance vectors shared with
  TypeScript, multipart joining, dual-SIM routing, import identity, upload policy).
- **Real SMS on an emulator:** `app/android/scripts/emulator-e2e.sh` needs a running emulator and the API on :8787.
  CI runs it on every push (`.github/workflows/ci.yml`).

### What each kind of test proves

| Test | Real | Simulated |
| --- | --- | --- |
| `shared/test/*` | Parser, money, phone, periods, validation | — |
| `server/test/api.test.ts` | Postgres, RLS, idempotency, concurrency, audit, totals, balances, events | HTTP calls via Fastify inject |
| `app/test/outbox.test.ts` | Queue logic, restart recovery, conflicts | IndexedDB (fake-indexeddb), server replies |
| `e2e/flow.spec.ts` | Browser UI, API, Postgres, live updates, conflict screen | The source phone: the test sends the uploader's HTTP requests |
| `RealSmsFlowTest` + `emulator-e2e.sh` | Android SMS delivery (`adb emu sms send`), receiver, multipart, filter, SIM routing, encrypted queue, WorkManager, offline then reconnect, inbox import, real API | The SIM network is the emulator's modem |
| Physical phone | **Not yet done** (see below) | — |

## Still needed before production (cannot be done from here)

1. **Hosting:**
   - A PostgreSQL database with a normal (non-superuser) role.
   - A Node 22 host behind HTTPS for the API, with `NODE_ENV=production`, `COOKIE_SECURE=true` and
     `TRUST_PROXY=true` behind a proxy.
   - Set `CORS_ORIGINS` to include `https://localhost` (the Android WebView).
2. **Android release signing:** create and safely keep an upload/signing key, then build a release with
   `VITE_API_BASE` set to the production API.
3. **Google Play:** apps that use SMS permissions without being the default SMS app must submit Google Play's
   Permissions Declaration, and approval is not guaranteed. Direct APK distribution (sideloading) needs no approval.
4. **Physical-device check on the real EVC SIM:**
   - Receive one real incoming and one real outgoing EVC Plus SMS.
   - On a dual-SIM phone, confirm the SIM is identified.
   - Check with the phone offline, after a reboot, and with the manufacturer's battery saver on.
   - Compare the amounts with the original SMS.
5. **More EVC Plus formats:** only the formats in the tests are recognised automatically. Merchant payments, bills,
   airtime and English-language receipts currently go to review. Add redacted real examples as parser test vectors.
