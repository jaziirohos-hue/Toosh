/** Applies server/migrations/*.sql in order, once each, under an advisory lock. */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, type Db } from './db.ts';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

/**
 * Gives the runtime role exactly what the API needs, and nothing that could bypass account isolation: it can read
 * and write rows (row-level security still applies), but it owns nothing, cannot change or drop tables, cannot
 * delete messages, and cannot see the migration bookkeeping.
 */
export async function grantRuntimeRole(db: Db, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('APP_DB_ROLE must be a plain lower-case role name');
  const sql = [
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `REVOKE CREATE ON SCHEMA public FROM ${role}`,
    `GRANT SELECT, INSERT, UPDATE ON accounts, devices, evc_numbers, messages, message_changes, pairing_codes TO ${role}`,
    `REVOKE ALL ON schema_migrations FROM ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `GRANT EXECUTE ON FUNCTION app_setting(text), app_account() TO ${role}`,
    // 002: expenses and budgets. Expenses and categories are hidden/archived, never deleted; a budget or an EVC
    // payment's category can be removed.
    `GRANT SELECT, INSERT, UPDATE ON expense_categories, expenses, savings_goals TO ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON transaction_categories, budgets TO ${role}`,
    `GRANT EXECUTE ON FUNCTION is_builtin_category(text) TO ${role}`,
    // 003: recovery codes are marked used or replaced, never deleted.
    `GRANT SELECT, INSERT, UPDATE ON recovery_codes TO ${role}`,
  ];
  for (const statement of sql) await db.query(statement);
}

export async function migrate(db: Db): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const files = (await readdir(MIGRATIONS)).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(MIGRATIONS + file, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
  const db = createPool(url);
  migrate(db).then(async applied => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
    if (process.env.APP_DB_ROLE) { await grantRuntimeRole(db, process.env.APP_DB_ROLE); console.log(`Granted row access to ${process.env.APP_DB_ROLE}`); }
    return db.end();
  }).catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
}
