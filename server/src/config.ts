/** All configuration comes from environment variables (see .env.example). */
export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  production: boolean;
  /** Origins allowed to call the API with a bearer token (the Android WebView, local dev). */
  corsOrigins: string[];
  cookieSecure: boolean;
  /** Directory with the built web app (app/dist) to serve for browser viewing devices. Optional. */
  webDist: string | null;
  trustProxy: boolean;
  /** Only for local testing: allow a database role that bypasses row-level security. */
  allowRlsBypass: boolean;
  logLevel: string;
  /** Sign-in/registration attempts allowed per IP per minute. */
  authRateLimit: number;
}

/**
 * Connection used by the running API. Hosted databases (e.g. Neon via the Vercel integration) inject an OWNER
 * connection as DATABASE_URL; the API must not use it. Preference:
 *   1. TOOSH_DATABASE_URL - explicit runtime connection
 *   2. DATABASE_URL with the user replaced by TOOSH_APP_DB_ROLE (default toosh_app) and TOOSH_APP_DB_PASSWORD
 *   3. DATABASE_URL as is (local setups that already point at the runtime role)
 */
export function runtimeDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TOOSH_DATABASE_URL) return env.TOOSH_DATABASE_URL;
  const base = env.DATABASE_URL ?? env.POSTGRES_URL ?? '';
  if (base && env.TOOSH_APP_DB_PASSWORD) {
    const u = new URL(base);
    u.username = env.TOOSH_APP_DB_ROLE ?? 'toosh_app';
    u.password = env.TOOSH_APP_DB_PASSWORD;
    return u.toString();
  }
  return base;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = runtimeDatabaseUrl(env);
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl,
    production,
    corsOrigins: (env.CORS_ORIGINS ?? 'https://localhost,capacitor://localhost,http://localhost:5173')
      .split(',').map(s => s.trim()).filter(Boolean),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    webDist: env.WEB_DIST || null,
    trustProxy: env.TRUST_PROXY === 'true',
    allowRlsBypass: env.ALLOW_RLS_BYPASS === 'true',
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'warn'),
    authRateLimit: Number(env.AUTH_RATE_LIMIT ?? 10),
  };
}
