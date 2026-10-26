// Old bug 5: tables were made by clicking in a dashboard, so nobody could
// rebuild the database or tell what had changed.
// Fix: db/migrations is the only source of truth. This builds a brand-new
// empty database from the migrations alone, rolls them back, and builds it
// again. (Every database test already runs on a database built this way:
// test/db/globalSetup.ts.)
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBinary } from 'dbmate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const testDb = inject('testDb');
const migrationsDir = resolve(import.meta.dirname, '../../../db/migrations');
const SCRATCH = 'mahub_regress_migrations';

describe.skipIf(!testDb)('old bug 5: the schema can only come from migrations', () => {
  let server: pg.Client;
  let scratchUrl: string;
  const dbmate = (...args: string[]) =>
    execFileSync(resolveBinary(), ['--url', scratchUrl, '--migrations-dir', migrationsDir, '--no-dump-schema', ...args], {
      stdio: 'pipe',
    });
  const count = async (sql: string) => {
    const c = new pg.Client({ connectionString: scratchUrl });
    await c.connect();
    try {
      return (await c.query(sql)).rows[0].n as number;
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    const url = new URL(testDb!.adminUrl);
    url.pathname = '/postgres';
    server = new pg.Client({ connectionString: url.toString() });
    await server.connect();
    await server.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await server.query(`CREATE DATABASE ${SCRATCH}`);
    url.pathname = `/${SCRATCH}`;
    scratchUrl = url.toString();
  });

  afterAll(async () => {
    await server?.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await server?.end();
  });

  it('every migration runs on an empty database, rolls back, and runs again', async () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const tables = `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'api' AND table_type = 'BASE TABLE'`;

    dbmate('up');
    expect(await count('SELECT count(*)::int AS n FROM schema_migrations')).toBe(files.length);
    const tablesAfterUp = await count(tables);
    expect(tablesAfterUp).toBeGreaterThanOrEqual(10);

    // Roll back everything except the first migration: its down step drops
    // the shared DB roles, which the other databases on this server still use.
    for (let i = 1; i < files.length; i++) dbmate('rollback');
    expect(await count('SELECT count(*)::int AS n FROM schema_migrations')).toBe(1);
    expect(await count(tables)).toBe(0);

    dbmate('up');
    expect(await count(tables)).toBe(tablesAfterUp);
  });
});
