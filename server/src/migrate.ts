/** Applies server/migrations/*.sql in order, once each, under an advisory lock. */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, type Db } from './db.ts';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

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
  migrate(db).then(applied => { console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date'); return db.end(); })
    .catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
}
