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

### Expenses, budgets and goals ("Maamul Qarashaadkaaga Si Fudud.")

- **Qarash tab:** outgoing EVC Plus payments and hand-entered expenses in one list, with search, filters (category,
  source, paid/unpaid, currency) and day/week/month/custom periods. Each expense has a name, amount, currency (USD or
  SOS), category, date, optional description and payment status. Editing uses a version check, so an older edit
  never silently overwrites a newer one. Deleting hides the row (`deleted_at`), it is not erased.
- **Categories:** Biil (Bills), Korantada, Iskuulka, Dugsiga, Gaari Raac, Kirada, Biyaha, Cuntada, Internet,
  Caafimaadka, Qarashaad Kale, plus your own. An outgoing EVC payment can be given a category (stored apart from
  the SMS record, which never changes).
- **Spending** = outgoing EVC payments + paid manual expenses. Unpaid bills are shown separately. USD and SOS are
  never added together or converted.
- **Budgets:** daily, weekly or monthly, overall or per category, with a warning level; Guud and Qarash show
  warnings when a budget nears or passes its limit (in-app alerts, not phone notifications).
- **Savings goals** with progress.
- **Guud** shows income, spending and what is left, today/week/month spending, spending by category and budgets.

### App lock, account and preferences

- **App PIN** (4–6 digits): stored only on the device as a PBKDF2-SHA-256 hash with a random salt; wrong guesses
  back off (after 5: 30 s, doubling, up to 1 hour). Optional fingerprint / phone screen lock on Android. Locks on
  open, after leaving the app for the chosen time, and after inactivity. Signing out removes the PIN.
- **Password:** change it in Dejinta (needs the current one; other viewing devices are signed out, the SMS phone
  stays connected). **Recovery codes:** 10 one-time codes, stored as scrypt hashes and shown once; "Ma ilowday
  furaha sirta?" on sign-in uses one to set a new password. Wrong codes count toward the sign-in lockout.
- **Hide amounts** (eye icon or Dejinta) shows ****** instead of every amount, remembered on the device.
- **Language** Somali (default) or English, **theme** system/light/dark, **default currency** USD or SOS.

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

Live at **https://toosh.vercel.app** (free Vercel + Neon). Setup, limits and secrets: [docs/HOSTING.md](docs/HOSTING.md).

## Local setup (verified)

Verified on Ubuntu 24.04 with Node 22.22, npm 10.9, PostgreSQL 16.15, OpenJDK 21 and the Android SDK (platform 36,
build-tools 36.0.0) at `/opt/android-sdk`. Everything below was run and checked on that machine.

### 1. Database: local PostgreSQL, three roles

| Role | Used for | Rights |
| --- | --- | --- |
| `toosh_owner` | migrations only (`.env.migration`) | owns the `toosh` database, schema and tables; not superuser |
| `toosh_app` | the running API (`DATABASE_URL` in `.env`) | SELECT/INSERT/UPDATE on rows only. Owns nothing, cannot DELETE messages, cannot change tables, not superuser, no BYPASSRLS. Row-level security applies |
| `toosh_test_admin` + `toosh_test` | `npm test` only | creates and drops throwaway test databases; not superuser |

Authentication is `scram-sha-256` on `127.0.0.1`/`::1` only; the `postgres` superuser is reachable only through its OS
account (peer). Passwords are random and live only in `.env` / `.env.migration` (git-ignored, mode 600).

One-time setup, run as the PostgreSQL admin (`sudo -u postgres psql`), with your own generated passwords:

```sql
CREATE ROLE toosh_owner LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE toosh_app   LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE toosh OWNER toosh_owner;
\c toosh
REVOKE ALL ON DATABASE toosh FROM PUBLIC;
GRANT CONNECT ON DATABASE toosh TO toosh_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO toosh_owner;
-- for npm test:
CREATE ROLE toosh_test_admin LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE;
ALTER ROLE toosh_test_admin SET createrole_self_grant = 'set, inherit';
CREATE ROLE toosh_test LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
GRANT toosh_test TO toosh_test_admin WITH ADMIN TRUE, SET TRUE, INHERIT TRUE;
```

### 2. Configuration

```bash
npm ci
cp .env.example .env    # set DATABASE_URL (toosh_app), TEST_* values; keep MIGRATE_ON_START=false
# create .env.migration with MIGRATION_DATABASE_URL (toosh_owner) and APP_DB_ROLE=toosh_app (see .env.example)
chmod 600 .env .env.migration
npm run db:migrate              # applies migrations as toosh_owner, then grants toosh_app row access
npm run db:verify -w server     # 12 security checks as the runtime role
```

`npm run db:verify -w server` confirms all of the following; its writes are rolled back.

- The runtime role is not superuser and has no BYPASSRLS.
- It owns no tables.
- Row-level security is enabled and forced on all 6 tables, and each table has an ownership policy.
- The runtime role cannot turn row-level security off, delete messages, read migration bookkeeping or create tables.
- Two accounts cannot see, change or insert into each other's rows.
- Without an account context, nothing is visible.

### 3. Build and run

```bash
npm run build                    # web app -> app/dist (served by the API)
scripts/local/start.sh           # starts PostgreSQL if needed, then the API in the background
scripts/local/status.sh          # database, API process, and GET / status code
scripts/local/stop.sh            # stops the API;  scripts/local/stop.sh --with-db  also stops PostgreSQL
```

The app and API are at **http://localhost:8787**. The server log is `.run/server.log` and the process id is in
`.run/server.pid`. The scripts assume the cluster at `/var/lib/postgresql/toosh-data` (override with `TOOSH_PGDATA` /
`TOOSH_PGBIN`); on a machine with a system PostgreSQL service, start that service instead.

### 4. Android app

The address is baked into the app at build time, so rebuild after changing it:

```bash
VITE_API_BASE=http://10.0.2.2:8787 npm run android -w app   # checks the address, builds the web assets, cap sync
cd app/android && ./gradlew testDebugUnitTest assembleDebug
# -> app/android/app/build/outputs/apk/debug/app-debug.apk
```

Choose `VITE_API_BASE` for where the app will run. `localhost` on a phone means the phone itself, not your computer.

| Where the app runs | VITE_API_BASE |
| --- | --- |
| Android emulator on the same computer as the server | `http://10.0.2.2:8787` |
| Phone on USB, after `adb reverse tcp:8787 tcp:8787` | `http://localhost:8787` |
| Phone on the same Wi-Fi | `http://<computer's LAN IP>:8787`. The server listens on all interfaces (`HOST=0.0.0.0`); allow port 8787 in the firewall |
| Production | `https://your-domain` |

Plain HTTP is a debug-only exception:

- `npm run android -w app` refuses `http://` addresses that are not local, emulator or LAN hosts.
- For an allowed `http://` address it adds that host to the debug-only network security config
  (`app/android/app/src/debug/res/xml`).
- It enables WebView mixed content only when the address is `http://`.
- Release builds keep the HTTPS-only config in `src/main`.

Install a debug APK with `adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk`.

## Tests

```bash
npm test                                  # shared (25), API with Postgres + RLS (30), app offline queue (4)
npm run typecheck
npx playwright test                       # needs the API running (scripts/local/start.sh); 11 browser tests
node scripts/check-deployment.mjs <url>   # auth, isolation, persistence, two-client sync against a deployment
cd app/android && ./gradlew testDebugUnitTest   # 5 native JVM tests
```

Playwright creates test accounts in the local `toosh` database through the public API.

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
| `e2e/finance.spec.ts` | Expenses, EVC categories, budgets, goals, hide amounts, language, theme, app PIN, password change, recovery codes | The source phone |
| `e2e/flow.spec.ts` | Browser UI, API, Postgres, live updates, conflict screen | The source phone: the test sends the uploader's HTTP requests |
| `RealSmsFlowTest` + `emulator-e2e.sh` | Android SMS delivery (`adb emu sms send`), receiver, multipart, filter, SIM routing, encrypted queue, WorkManager, offline then reconnect, inbox import, real API | The SIM network is the emulator's modem |
| Physical phone | **Not yet done** (see below) | — |

## Still needed before production (cannot be done from here)

1. **Hosting:** free hosting on Vercel + Neon is prepared. See [docs/HOSTING.md](docs/HOSTING.md) for the limits,
   the secrets and the setup steps. Any other Node 22 host with HTTPS also works: run `npm run start -w server` with
   `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, and a non-owning database role.
2. **Android release signing:** create and safely keep an upload/signing key, then build a release with
   `VITE_API_BASE` set to the production API.
3. **Google Play:** apps that use SMS permissions without being the default SMS app must submit Google Play's
   Permissions Declaration, and approval is not guaranteed. Direct APK distribution (sideloading) needs no approval.
4. **Physical-device check on the real EVC SIM:**
   - Receive one real incoming and one real outgoing EVC Plus SMS.
   - On a dual-SIM phone, confirm the SIM is identified.
   - Check with the phone offline, after a reboot, and with the manufacturer's battery saver on.
   - Compare the amounts with the original SMS.
5. **eDahab (Somtel) and Jeeb (Somnet):** not supported yet. Real sample messages (money in, money out, balance)
   are needed to write and test their formats.
6. **Ads:** not added. Vercel Hobby is for non-commercial use; ads need a paid plan or another host.
7. **More EVC Plus formats:** only the formats in the tests are recognised automatically. Merchant payments, bills,
   airtime and English-language receipts currently go to review. Add redacted real examples as parser test vectors.
