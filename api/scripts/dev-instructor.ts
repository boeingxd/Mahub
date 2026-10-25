// Makes a real Google email an instructor of the seeded classes, so you can
// sign in as one while developing.
//
//   1. put your own email in .env (the file git ignores):  DEV_INSTRUCTOR_EMAIL=you@gmail.com
//   2. from api/:                                          npm run db:dev-instructor
//      (or give the email directly:                        npm run db:dev-instructor -- you@gmail.com)
//
// Why a script and not a line in db/seeds/seed.sql: seed.sql is committed to git
// and shared, and a real email must not end up in git history. This reads the
// email from your own .env instead, so it never leaves your laptop.
//
// Why it is needed at all: the seeded instructors (instructor1@example.com...)
// don't exist at Google, so nobody can sign in as them. The login policy
// (ADR 0007) says an instructor must already be registered by an admin; this
// registers you. After that, "Sign in with Google" matches your email, and the
// first login links your Google account to the row.
//
// Safe to run again. It connects as the postgres admin (DATABASE_URL, like
// dbmate) and refuses to run against anything but a local database.
import { pathToFileURL } from 'node:url';
import pg from 'pg';

// The two seeded sections the dev instructor takes over: ITS332 section 1 and
// ITS323 section 1 (the ones "Dev Instructor One" teaches in db/seeds/seed.sql).
export const SEED_SECTIONS = ['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3'];
const SEED_ADMIN = '00000000-0000-0000-0000-0000000000a1';

// One address, no spaces, no commas, nothing sneaky: it goes straight into a row
// that the login policy trusts.
export function parseEmail(raw: string | undefined): string {
  const email = (raw ?? '').trim().toLowerCase();
  if (!/^[^\s@,;]+@[^\s@,;]+$/.test(email)) {
    throw new Error('Give one valid email address (DEV_INSTRUCTOR_EMAIL in .env, or as the first argument).');
  }
  return email;
}

// A dev script must never be able to rewrite a real server's instructors.
export function assertLocalDatabase(url: string | undefined): void {
  let host: string;
  try {
    host = new URL(url ?? '').hostname;
  } catch {
    // Don't echo the address: it may contain the password.
    throw new Error('DATABASE_URL is missing or is not a valid address.');
  }
  if (!['localhost', '127.0.0.1', '[::1]', '::1', 'db'].includes(host)) {
    throw new Error(`Refusing to run: the database host "${host}" is not local. This script is for your own laptop only.`);
  }
}

// Registers `email` as an instructor of `sectionIds`. Safe to repeat.
export async function registerDevInstructor(
  client: pg.ClientBase,
  email: string,
  sectionIds: string[] = SEED_SECTIONS,
  fullName = 'Dev Instructor',
): Promise<{ userId: string; sectionsUpdated: number }> {
  await client.query('BEGIN');
  try {
    // The user row, if it doesn't exist yet. google_sub stays empty until the
    // first Google login, which fills it in. (An existing user, say a student
    // who has already logged in, is left as it is.)
    await client.query('INSERT INTO api.users (email, full_name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [
      email,
      fullName,
    ]);
    const { rows } = await client.query<{ id: string }>('SELECT id FROM api.users WHERE email = $1', [email]);
    const userId = rows[0]!.id;

    // The instructor role, granted by the seeded admin (or by nobody, if this
    // database has no seeded admin).
    await client.query(
      `INSERT INTO api.user_roles (user_id, role, granted_by)
       VALUES ($1, 'instructor', (SELECT id FROM api.users WHERE id = $2))
       ON CONFLICT DO NOTHING`,
      [userId, SEED_ADMIN],
    );

    // Take over the sections. Only those exact ids; nothing else is touched.
    const updated = await client.query('UPDATE api.sections SET instructor_id = $1 WHERE id = ANY($2::uuid[])', [
      userId,
      sectionIds,
    ]);
    await client.query('COMMIT');
    return { userId, sectionsUpdated: updated.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const email = parseEmail(process.argv[2] ?? process.env.DEV_INSTRUCTOR_EMAIL);
  const adminUrl = process.env.DATABASE_URL;
  assertLocalDatabase(adminUrl);

  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const name = process.env.DEV_INSTRUCTOR_NAME?.trim() || undefined;
    const { sectionsUpdated } = await registerDevInstructor(client, email, SEED_SECTIONS, name);
    if (sectionsUpdated !== SEED_SECTIONS.length) {
      console.warn(
        `Registered ${email} as an instructor, but only ${sectionsUpdated} of ${SEED_SECTIONS.length} seeded sections were found. Did you load db/seeds/seed.sql?`,
      );
    } else {
      console.log(`${email} is now an instructor of ${sectionsUpdated} sections (ITS332 and ITS323).`);
      console.log('Sign in with Google using that address.');
    }
  } finally {
    await client.end();
  }
}

// Run only when started from the command line, not when a test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
