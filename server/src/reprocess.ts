/**
 * Re-runs the current parser over stored messages after a parser upgrade.
 * Manually classified messages keep every user value; only their stored parser suggestion is refreshed.
 *
 *   npm run reprocess -w server -- --account <account-uuid>
 *
 * Each account is processed inside its own row-level-security context, so the regular DATABASE_URL role works.
 */
import { createPool, withAccount } from './db.ts';
import { reprocessMessage } from './messages.ts';

const args = process.argv.slice(2);
const accountId = args[args.indexOf('--account') + 1];
if (!args.includes('--account') || !/^[0-9a-f-]{36}$/i.test(accountId ?? '')) {
  console.error('Usage: npm run reprocess -w server -- --account <account-uuid>');
  process.exit(1);
}
const db = createPool(process.env.DATABASE_URL!);
const ids = await withAccount(db, accountId, async tx => (await tx.query('SELECT id FROM messages WHERE account_id = $1 ORDER BY received_at', [accountId])).rows.map(r => r.id));
let changed = 0; let manual = 0;
for (const id of ids) {
  const r = await withAccount(db, accountId, tx => reprocessMessage(tx, accountId, id));
  if (r.changed) changed++;
  if (r.manual) manual++;
}
console.log(`Reprocessed ${ids.length} messages: ${changed} updated by the parser, ${manual} manual classifications kept.`);
await db.end();
