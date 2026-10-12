import pg from 'pg';

// A connection pool keeps a few database connections open and lends one to
// each query. Opening a fresh connection per request would be much slower.
export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    // Plenty for our load target (~10 requests/s). Postgres allows 100 in total.
    max: 10,
    // If the DB is down, give up after 2s instead of hanging the request.
    connectionTimeoutMillis: 2000,
    // Close connections that have been unused for 30s.
    idleTimeoutMillis: 30_000,
  });
}

// The only thing the app needs from a pool right now. Tests pass in a fake
// object with this shape, so they don't need a real database.
export type Queryable = Pick<pg.Pool, 'query'>;

// Runs `fn` in one transaction "as" this user, so the row-level security
// policies (db/migrations/*_rls.sql) know who is asking:
//
//   BEGIN
//   SELECT set_config('app.user_id', '<uuid>', true)   -- policies read this
//   ...your queries...
//   COMMIT   (or ROLLBACK if anything throws)
//
// set_config(..., true) is the same as SET LOCAL: the setting disappears when
// the transaction ends, so the next request on this pooled connection can't
// inherit someone else's id. (SET LOCAL itself can't take a $1 parameter.)
export async function withUser<T>(
  pool: Pick<pg.Pool, 'connect'>,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // give the connection back to the pool
  }
}

// Superusers (like `postgres`) and BYPASSRLS roles skip every row-level
// security policy. If the API ever connected as one by mistake, all the
// security rules would silently stop working, so refuse to start instead.
export async function assertRlsApplies(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
  );
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      'The API database user skips row-level security (superuser or BYPASSRLS). ' +
        'Set API_DATABASE_URL to the mahub_api user (see .env.example).',
    );
  }
}
