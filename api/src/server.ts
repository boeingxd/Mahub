import { buildApp } from './app.js';
import { createGoogleAuth } from './auth/google.js';
import { createUserStore } from './auth/userStore.js';
import { createCheckinStore } from './checkin/checkinStore.js';
import { createQrStore } from './checkin/qrStore.js';
import { loadConfig } from './config.js';
import { assertRlsApplies, createPool } from './db.js';
import { createReportsStore } from './reports/reportsStore.js';
import { createSectionsStore } from './sections/sectionsStore.js';

const config = loadConfig();
const pool = createPool(config.API_DATABASE_URL);
const app = buildApp({
  db: pool,
  logLevel: config.LOG_LEVEL,
  trustProxy: config.TRUST_PROXY,
  auth: {
    google: createGoogleAuth({
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: config.GOOGLE_REDIRECT_URI,
    }),
    users: createUserStore(pool),
    sessionKey: Buffer.from(config.SESSION_KEY, 'hex'),
  },
  checkin: { qrSecret: config.QR_SECRET, store: createQrStore(pool), checkins: createCheckinStore(pool) },
  sections: { store: createSectionsStore(pool) },
  reports: { store: createReportsStore(pool) },
});

// Without this, an idle pooled connection that dies (e.g. the DB restarts)
// emits an 'error' event that would crash the whole process.
pool.on('error', (err) => app.log.error({ err }, 'idle database connection failed'));

// When the app shuts down, close the pool's connections too.
app.addHook('onClose', async () => {
  await pool.end();
});

// Docker sends SIGTERM on `docker compose stop`; Ctrl+C sends SIGINT.
// Close cleanly so in-flight requests finish and DB connections are released.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  // Refuse to start as a superuser: row-level security wouldn't apply.
  await assertRlsApplies(pool);
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.fatal({ err }, 'failed to start');
  process.exit(1);
}
