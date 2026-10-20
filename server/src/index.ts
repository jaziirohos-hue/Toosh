import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { checkRlsRole, createPool } from './db.ts';
import { ChangeHub } from './events.ts';
import { migrate } from './migrate.ts';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const role = await checkRlsRole(db);
if (role.bypasses && !config.allowRlsBypass) {
  console.error(`Database role "${role.role}" is SUPERUSER or BYPASSRLS, so account isolation would rely on application code alone. ` +
    'Use a normal role (see README) or set ALLOW_RLS_BYPASS=true for local experiments only.');
  process.exit(1);
}
// A table owner could switch row-level security off for its tables; production runs as a separate, non-owning role.
if (role.ownsTables > 0) {
  const message = `Database role "${role.role}" owns the Toosh tables. Run the API as a separate role (see README "Local setup").`;
  if (config.production && !config.allowRlsBypass) { console.error(message); process.exit(1); }
  console.warn(`Warning: ${message}`);
}
if (process.env.MIGRATE_ON_START !== 'false') await migrate(db);
const hub = new ChangeHub(config.databaseUrl);
await hub.start();
const app = await buildApp(config, db, hub);
await app.listen({ port: config.port, host: config.host });
console.log(`Toosh API listening on ${config.host}:${config.port}`);

const shutdown = async () => { await app.close(); await hub.stop(); await db.end(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
