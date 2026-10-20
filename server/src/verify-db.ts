/**
 * Checks the live database's security setup as the runtime role (DATABASE_URL):
 *   npm run db:verify -w server
 * Everything it writes happens inside a transaction that is rolled back.
 */
import { randomUUID } from 'node:crypto';
import { checkRlsRole, createPool } from './db.ts';

const TABLES = ['accounts', 'devices', 'evc_numbers', 'messages', 'message_changes', 'pairing_codes'];
const db = createPool(process.env.DATABASE_URL!);
let failures = 0;
const check = (ok: boolean, label: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };
async function denied(sql: string, params: unknown[] = []) {
  const c = await db.connect();
  try { await c.query('BEGIN'); await c.query(sql, params); return false; } catch { return true; } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}

try {
  const role = await checkRlsRole(db);
  check(!role.bypasses, `runtime role "${role.role}" is not SUPERUSER and has no BYPASSRLS`);
  check(role.ownsTables === 0, 'runtime role owns no tables');
  const { rows } = await db.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) AND relkind = 'r'`, [TABLES]);
  check(rows.length === TABLES.length && rows.every(r => r.relrowsecurity && r.relforcerowsecurity), `row-level security enabled and forced on ${TABLES.length} tables`);
  const pol = await db.query(`SELECT count(DISTINCT tablename)::int AS n FROM pg_policies WHERE tablename = ANY($1)`, [TABLES]);
  check(pol.rows[0].n === TABLES.length, 'every table has an ownership policy');
  check(await denied('ALTER TABLE messages DISABLE ROW LEVEL SECURITY'), 'runtime role cannot switch row-level security off');
  check(await denied('DELETE FROM messages'), 'runtime role cannot delete messages');
  check(await denied('SELECT * FROM schema_migrations'), 'runtime role cannot read migration bookkeeping');
  check(await denied('CREATE TABLE toosh_probe (id int)'), 'runtime role cannot create tables');

  // Functional isolation, rolled back: two accounts, each sees only itself.
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const a = randomUUID(), b = randomUUID();
    const phone = () => `+25261${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    for (const id of [a, b]) {
      await c.query(`SELECT set_config('app.account_id', $1, true)`, [id]);
      await c.query(`INSERT INTO accounts (id, display_name, login_phone, password_hash) VALUES ($1, 'verify', $2, 'x')`, [id, phone()]);
      await c.query(`INSERT INTO evc_numbers (id, account_id, msisdn) VALUES ($1, $2, $3)`, [randomUUID(), id, phone()]);
    }
    await c.query(`SELECT set_config('app.account_id', $1, true)`, [a]);
    const seen = (await c.query('SELECT account_id FROM evc_numbers')).rows;
    check(seen.length === 1 && seen[0].account_id === a, 'account A sees only its own EVC number (query without a WHERE clause)');
    const cross = await c.query(`UPDATE evc_numbers SET display_name = 'x' WHERE account_id = $1`, [b]);
    check(cross.rowCount === 0, "account A cannot change account B's rows");
    await c.query(`SELECT set_config('app.account_id', '', true)`);
    check((await c.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n === 0, 'no account context: nothing visible');
    let blocked = false;
    try { await c.query('SAVEPOINT s'); await c.query(`SELECT set_config('app.account_id', $1, true)`, [a]); await c.query(`INSERT INTO evc_numbers (id, account_id, msisdn) VALUES ($1, $2, $3)`, [randomUUID(), b, phone()]); }
    catch { blocked = true; await c.query('ROLLBACK TO SAVEPOINT s'); }
    check(blocked, "account A cannot insert rows into account B");
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
} catch (e) {
  console.error('Database check could not run:', (e as Error).message); failures++;
} finally {
  await db.end();
}
console.log(failures ? `${failures} check(s) failed` : 'All database security checks passed');
process.exit(failures ? 1 : 0);
