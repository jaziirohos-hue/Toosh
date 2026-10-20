/**
 * Vercel Function entry. Bundled by scripts/vercel-build.mjs into .vercel/output/functions/api.func.
 * One Fastify instance per warm function instance; no long-lived event stream (clients poll /api/v1/changes).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { checkRlsRole, createPool } from './db.ts';

let ready: Promise<FastifyInstance> | null = null;

async function init() {
  const config = loadConfig({ ...process.env, NODE_ENV: 'production', TRUST_PROXY: 'true' });
  const db = createPool(config.databaseUrl, { max: 3 });
  const role = await checkRlsRole(db);
  // Same rule as the long-running server: never serve as a role that can bypass account isolation.
  if (role.bypasses || role.ownsTables > 0) throw new Error(`Refusing to serve as database role "${role.role}" (superuser, BYPASSRLS or table owner).`);
  const app = await buildApp(config, db, null);
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    ready ??= init();
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (error) {
    ready = null; // retry setup on the next request (e.g. the database was waking up)
    console.error('Toosh API setup failed:', (error as Error).message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', '10');
    res.end(JSON.stringify({ error: 'UNAVAILABLE', message: 'Adeeggu hadda ma shaqeynayo. Isku day mar kale.' }));
  }
}
