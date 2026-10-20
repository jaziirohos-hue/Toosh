import pg from 'pg';

// BIGINT (money in thousandths, sequence numbers) is returned as a string and converted to bigint explicitly;
// it is never turned into a JavaScript Number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => v);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, opts: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
  pool.on('error', () => { /* idle client errors are retried on next checkout */ });
  return pool;
}

type Settings = Partial<Record<'app.account_id' | 'app.token_hash' | 'app.login_phone' | 'app.pairing_hash', string>>;

/** Runs fn in one database transaction with the given row-level-security settings (local to the transaction). */
export async function inTx<T>(db: Db, settings: Settings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction scoped to one account: RLS hides every other account's rows. */
export function withAccount<T>(db: Db, accountId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTx(db, { 'app.account_id': accountId }, fn);
}

/** Refuses (in production) to run as a role that would ignore row-level security. */
export async function checkRlsRole(db: Db): Promise<{ bypasses: boolean; role: string; ownsTables: number }> {
  const { rows } = await db.query(`SELECT current_user AS role, (rolsuper OR rolbypassrls) AS bypasses,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owns
    FROM pg_roles WHERE rolname = current_user`);
  return { role: rows[0].role, bypasses: Boolean(rows[0].bypasses), ownsTables: rows[0].owns };
}

export const isUniqueViolation = (e: unknown, constraint?: string) =>
  (e as any)?.code === '23505' && (!constraint || (e as any)?.constraint === constraint);
