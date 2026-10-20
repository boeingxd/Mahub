// Creates (or updates) mahub_api, the database user the API logs in as.
// Run from api/:   npm run db:app-user
//
// It's a script, not a migration, because passwords never go in git: the
// password comes from APP_DB_PASSWORD in your .env. It connects with
// DATABASE_URL (the postgres admin that dbmate uses), so run `dbmate up` first:
// the app_rw role it joins is created by the migrations.
import pg from 'pg';

const adminUrl = process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;

if (!adminUrl) throw new Error('DATABASE_URL is missing from .env');
if (!password || password.length < 12 || password.startsWith('change-me')) {
  throw new Error('Set APP_DB_PASSWORD in .env to a real password of at least 12 characters');
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'mahub_api'");
  const verb = rowCount ? 'ALTER' : 'CREATE';
  // A password can't be a $1 parameter in CREATE ROLE, so let Postgres quote
  // it safely with format('%L') instead of gluing strings together ourselves.
  // NOSUPERUSER NOBYPASSRLS: row-level security must apply to the API.
  const { rows } = await client.query<{ sql: string }>(
    `SELECT format('%s ROLE mahub_api LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql`,
    [verb, password],
  );
  await client.query(rows[0]!.sql);
  // Membership in app_rw gives the API exactly app_rw's rights, no more.
  await client.query('GRANT app_rw TO mahub_api');
  console.log(`${verb === 'CREATE' ? 'Created' : 'Updated'} mahub_api (member of app_rw).`);
} finally {
  await client.end();
}
