// Runs once before all tests. Builds a fresh `mahub_test` database for the
// database security tests (test/db/*.test.ts), so they never touch your real
// `mahub` data:
//   1. drop and re-create mahub_test
//   2. run every migration in db/migrations (with dbmate)
//   3. load db/seeds/seed.sql
//   4. create a login user `mahub_test_app` that belongs to app_rw, exactly
//      like the API's mahub_api, with a new random password each run
//
// It needs DATABASE_URL (the postgres admin from your .env, the same one
// dbmate uses). Without one, the database tests are skipped with a warning.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBinary } from 'dbmate';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

export interface TestDb {
  adminUrl: string; // postgres superuser: sets up fixtures, skips RLS
  appUrl: string; // mahub_test_app (member of app_rw): RLS applies, like the API
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDb: TestDb | null;
  }
}

const repoRoot = resolve(import.meta.dirname, '../../..');
const TEST_DB = 'mahub_test';
const APP_ROLE = 'mahub_test_app';

// The same address, but a different database (and optionally user).
function urlFor(base: string, database: string, user?: string, password?: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
}

export default async function setup(project: TestProject) {
  const envFile = resolve(repoRoot, '.env');
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  const adminBase = process.env.DATABASE_URL;
  if (!adminBase) {
    console.warn('\n⚠ DATABASE_URL not set: skipping the database security tests (test/db/).\n');
    project.provide('testDb', null);
    return;
  }

  const server = new pg.Client({ connectionString: urlFor(adminBase, 'postgres') });
  try {
    await server.connect();
  } catch (err) {
    throw new Error('Database tests need Postgres running. From mahub/: docker compose up -d db', { cause: err });
  }
  await server.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await server.query(`CREATE DATABASE ${TEST_DB}`);

  const adminUrl = urlFor(adminBase, TEST_DB);
  execFileSync(
    resolveBinary(),
    ['--url', adminUrl, '--migrations-dir', resolve(repoRoot, 'db/migrations'), '--no-dump-schema', 'up'],
    { stdio: 'pipe' },
  );

  // Roles are shared by every database on the server, so this user may
  // already exist from an earlier run: then just give it a new password.
  const password = randomBytes(18).toString('hex');
  const { rowCount } = await server.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  const { rows } = await server.query<{ sql: string }>(
    `SELECT format('%s ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS sql`,
    [rowCount ? 'ALTER' : 'CREATE', password],
  );
  await server.query(rows[0]!.sql);
  await server.query(`GRANT app_rw TO ${APP_ROLE}`);
  await server.end();

  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  // The seed file starts with a byte-order mark (BOM); Postgres doesn't want it.
  await db.query(readFileSync(resolve(repoRoot, 'db/seeds/seed.sql'), 'utf8').replace(/^﻿/, ''));
  await db.end();

  project.provide('testDb', { adminUrl, appUrl: urlFor(adminBase, TEST_DB, APP_ROLE, password) });
}
