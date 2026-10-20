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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL ?? '';
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
