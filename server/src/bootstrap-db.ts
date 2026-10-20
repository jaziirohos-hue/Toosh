/**
 * Hosted database setup, run at deploy time (scripts/vercel-build.mjs) with the OWNER connection:
 *   1. apply migrations,
 *   2. create/update the runtime role (TOOSH_APP_DB_ROLE, default toosh_app) with TOOSH_APP_DB_PASSWORD:
 *      LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, owning nothing,
 *   3. grant it row access only.
 * Owner connection: MIGRATION_DATABASE_URL, else DATABASE_URL_UNPOOLED, else DATABASE_URL (Neon/Vercel names).
 * Without a configured database it exits successfully, so the web app can still be deployed.
 */
import { createPool } from './db.ts';
import { grantRuntimeRole, migrate } from './migrate.ts';

const ownerUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const role = process.env.TOOSH_APP_DB_ROLE ?? 'toosh_app';
const password = process.env.TOOSH_APP_DB_PASSWORD;

if (!ownerUrl) { console.log('bootstrap-db: no database configured yet; skipping.'); process.exit(0); }
if (!password || password.length < 24) { console.error('bootstrap-db: TOOSH_APP_DB_PASSWORD (24+ characters) is required.'); process.exit(1); }
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) { console.error('bootstrap-db: invalid TOOSH_APP_DB_ROLE'); process.exit(1); }

const db = createPool(ownerUrl, { max: 2 });
try {
  const applied = await migrate(db);
  console.log(applied.length ? `bootstrap-db: applied ${applied.join(', ')}` : 'bootstrap-db: schema up to date');
  const exists = (await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount;
  const esc = (v: string) => `'${v.replace(/'/g, "''")}'`;
  if (!exists) await db.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${esc(password)}`);
  // A non-superuser owner (as on Neon) may not name SUPERUSER/BYPASSRLS in ALTER ROLE, so only the password is
  // updated here; the attributes are verified below instead.
  else await db.query(`ALTER ROLE ${role} LOGIN PASSWORD ${esc(password)}`);
  const dbName = (await db.query('SELECT current_database() AS d')).rows[0].d;
  await db.query(`GRANT CONNECT ON DATABASE "${dbName.replace(/"/g, '""')}" TO ${role}`);
  await grantRuntimeRole(db, role);
  const check = (await db.query(`SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb AS bad,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1) AS owns FROM pg_roles WHERE rolname = $1`, [role])).rows[0];
  if (check.bad || check.owns) throw new Error(`runtime role ${role} must not be superuser, bypass row-level security, create roles or databases, or own tables`);
  console.log(`bootstrap-db: runtime role ${role} ready (row access only)`);
} catch (e) {
  console.error('bootstrap-db failed:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
