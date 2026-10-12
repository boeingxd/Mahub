import { z } from 'zod';

// Settings come from environment variables (in dev: the repo's .env file).
// We validate them with zod at startup so a missing or mistyped setting
// crashes immediately with a clear message, instead of failing later on
// the first request.
const ConfigSchema = z.object({
  // The API's own database user (mahub_api, a member of app_rw), NOT the
  // postgres superuser that dbmate uses: superusers skip row-level security.
  API_DATABASE_URL: z.url(),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Which proxy addresses may tell us the visitor's real IP (X-Forwarded-For),
  // as a comma-separated list of IPs or ranges, e.g. "172.28.1.0/24".
  // Empty = trust nobody, which is right for `npm run dev` with no proxy.
  TRUST_PROXY: z.string().default(''),

  // Google sign-in (task Y1). From Google Cloud console > APIs & Services >
  // Credentials > OAuth client ID (type "Web application").
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // Must be listed under "Authorized redirect URIs" in that client, exactly.
  GOOGLE_REDIRECT_URI: z.url(),
  // Encrypts the session cookie: 32 random bytes written as 64 hex characters.
  // Generate one with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
  // Signs the rotating QR tokens (task Y3). Anyone with it could make valid
  // QR codes. Generate one with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
  QR_SECRET: z.string().min(32, 'must be at least 32 random characters'),
  SESSION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)')
    .refine((k) => !/^0+$/.test(k), 'must be random, not all zeros'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    // Print which settings are wrong, never their values (API_DATABASE_URL holds a password).
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
