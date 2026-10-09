import { z } from 'zod';

// Settings come from environment variables (in dev: the repo's .env file).
// We validate them with zod at startup so a missing or mistyped setting
// crashes immediately with a clear message, instead of failing later on
// the first request.
const ConfigSchema = z.object({
  DATABASE_URL: z.url(),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    // Print which settings are wrong, never their values (DATABASE_URL holds a password).
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
