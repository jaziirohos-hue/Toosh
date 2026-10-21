# Hosting Toosh for free: Vercel + Neon

Toosh runs as one Vercel project:
- the web app is served as static files;
- the API is a single Vercel Function at `/api/*`;
- the database is a Neon Postgres database connected through the Vercel Marketplace.

Both have free plans that need no credit card. Nothing here buys anything.

## Current deployment (set up 2026-10-21)

- Address: **https://toosh.vercel.app** (Vercel project `toosh`, team `jaziiro`, region iad1 / Washington, D.C.).
- Database: Neon Free (`neon-cyclamen-diamond`, Washington, D.C.), connected with the variable prefix `DATABASE`.
- Deployed from the branch `claude/laughing-bohr-6fmo6s`. The project's production branch is still `main`, so a
  push to `main` without this code would make a failing build; Vercel keeps the last good deployment live when a
  build fails. To deploy new code, merge the branch into `main` or redeploy the branch from the Vercel dashboard.
- Vercel Authentication protects preview deployments only. Production is public, and Toosh's own sign-in
  protects every account's data.
- Verified on 2026-10-21 against https://toosh.vercel.app: `scripts/check-deployment.mjs` passed all 16 checks;
  the 3 browser tests passed, repeated twice.

## Free-plan limits (checked 2026-10-20)

| | Limit | Source |
| --- | --- | --- |
| Vercel Hobby | 1,000,000 function invocations/month; 4 h Active CPU/month; 360 GB-hrs provisioned memory; 100 GB fast data transfer; function max duration 300 s; personal, **non-commercial** use only | vercel.com/docs/limits, vercel.com/docs/limits/fair-use-guidelines |
| Neon Free | 0.5–1 GB storage per project (pricing page says 1 GB; some summaries say 0.5 GB — plan for 0.5 GB); 100 CU-hours compute per project per month; scales to zero after 5 minutes idle (cannot be turned off); not a trial, no expiry date | neon.com/pricing |

### Will any of this interrupt synchronization?

- **Sleeping:** Vercel Functions start on demand. Neon suspends after 5 idle minutes. The next request wakes it, which
  takes a fraction of a second up to a few seconds. Nothing is lost: the phone keeps every SMS in its encrypted queue
  until the server confirms it, and retries.
- **Expiration:** neither free plan has an end date. Rejected alternatives: Render's free Postgres is deleted after
  30 days; Supabase's free projects pause after 7 days without activity.
- **Compute limit (most likely limit to hit):** if the 100 CU-hours run out, Neon stops the database until the next
  month. Uploads then fail, and the phone keeps the SMS queued until the database is back. Toosh is built to stay well
  under the limit:
  - When idle, the source phone reports in about once an hour, not every 15 minutes.
  - Viewers check for changes every 8 s, but only while the app is on screen.
  - One hour of viewing keeps the database awake for that hour (about 0.25 CU-h at the smallest size). The phone's
    hourly check-ins come to about 15 CU-h a month.
- **Storage:** each EVC Plus SMS row is about 1–2 KB, so 0.5 GB holds hundreds of thousands of messages. When storage
  is full, Neon blocks writes but does not delete data.
- **Live updates:** Vercel functions cannot hold a connection open, so the hosted API has no live stream. Clients poll
  `/api/v1/changes` (a tiny request) instead. A change shows on other devices within about 8 s.
- **Logs:** Vercel Hobby keeps runtime logs for 1 hour.
- **Commercial use:** Vercel Hobby is for personal, non-commercial projects. A business would need a paid plan.

## Secrets: what is set where (never in git)

| Variable | Where | What |
| --- | --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (and `POSTGRES_*`) | Added automatically by the Neon integration | Database **owner** credentials. Used only at build time to migrate and to create the restricted role. The API refuses to run as the owner. |
| `TOOSH_APP_DB_PASSWORD` | Vercel → Project → Settings → Environment Variables, type **Sensitive** | Password of the restricted `toosh_app` role (≥ 24 random characters). Generate it with `openssl rand -base64 33`. |
| `TOOSH_DATABASE_URL` (optional) | Same | A complete runtime connection string, if you prefer to create the role yourself. It overrides the derived one. |
| `CORS_ORIGINS` (optional) | Same | Default `https://localhost,capacitor://localhost` (the Android app). |

On each build, `server/src/bootstrap-db.ts` does three things:
1. runs the migrations as the owner;
2. creates or updates `toosh_app` (no superuser, no BYPASSRLS, owns nothing) with `TOOSH_APP_DB_PASSWORD`;
3. checks that role.

At runtime the API connects as `toosh_app`: it takes the owner URL and replaces the user and password.

## Setup steps

1. **Connect the repository** (one time, needs your GitHub approval). In Vercel, choose *Add New → Project →
   Import Git Repository*, install the Vercel GitHub app for `jaziirohos-hue/Toosh`, and import it into the
   `jaziiro` team. Keep the settings `vercel.json` provides (install `npm ci`, build `npm run vercel-build`, output
   `.vercel/output`, no framework).
2. **Production branch:** Settings → Git → Production Branch → `claude/laughing-bohr-6fmo6s`, or merge that branch into
   `main`.
3. **Database:** Project → Storage → *Create Database* → **Neon** → *Free* plan. Connect it to the project for
   Production, Preview and Development.
4. **Secret:** add `TOOSH_APP_DB_PASSWORD` as described above, for Production and Preview.
5. **Redeploy.** Then open `https://<project>.vercel.app/api/v1/health?db=1`. It should show
   `{"ok":true,"live":false,"database":"ok"}`.
6. **Android app:** build it with the HTTPS address:
   ```bash
   VITE_API_BASE=https://<project>.vercel.app npm run android -w app
   cd app/android && ./gradlew assembleDebug
   ```

## Checking a deployment

```bash
curl https://<project>.vercel.app/api/v1/health?db=1
```

`scripts/check-deployment.mjs <url>` checks five things:
- it registers two test accounts;
- a second device on one account sees the first device's changes, through the change counter;
- the other account sees nothing;
- data is still there after a fresh sign-in;
- a request without a token is refused.
