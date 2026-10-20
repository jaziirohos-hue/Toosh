// Vercel build (vercel.json "buildCommand"). Produces .vercel/output (Build Output API v3):
//   static/                web app (app/dist), served from the CDN
//   functions/api.func/    the Toosh API bundled into one file, handling /api/*
// then prepares the database (migrations + restricted runtime role) when one is configured.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

const out = '.vercel/output';
const run = cmd => execSync(cmd, { stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
run('npm run build -w app');
mkdirSync(`${out}/static`, { recursive: true });
cpSync('app/dist', `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['server/src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: false, sourcemap: false,
  external: ['pg-native'],
  // Bundled CommonJS dependencies (fastify, pg) still call require(); give the ESM bundle a real one.
  banner: { js: "import { createRequire as __tooshRequire } from 'node:module'; const require = __tooshRequire(import.meta.url);" },
  logLevel: 'warning',
});
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30, shouldAddHelpers: false,
}, null, 2));
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }));

const security = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(.*)$', headers: security, continue: true },
    { src: '^/api/(.*)$', headers: { 'cache-control': 'no-store' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/api/(.*)$', dest: '/api' },
    { src: '^/.*$', dest: '/index.html' },
  ],
}, null, 2));

if (process.env.SKIP_DB_BOOTSTRAP !== 'true') run('node --import tsx server/src/bootstrap-db.ts');
console.log('Vercel output ready in .vercel/output');
