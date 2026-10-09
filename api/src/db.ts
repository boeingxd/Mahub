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
