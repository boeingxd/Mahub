// Shared bits for the regression tests: one file per bug from the old app
// (PROJECT_PLAN.md §2). Each test recreates the bug and checks it is blocked.
import pg from 'pg';
import type { TestDb } from '../db/globalSetup.js';

// Fixed ids from db/seeds/seed.sql.
export const SEED = {
  ADMIN: '00000000-0000-0000-0000-0000000000a1',
  INSTRUCTOR_1: '00000000-0000-0000-0000-0000000000b1',
  COURSE_D1: '00000000-0000-0000-0000-0000000000d1',
  COURSE_D2: '00000000-0000-0000-0000-0000000000d2',
  ROOM_F1: '00000000-0000-0000-0000-0000000000f1',
};

// admin = superuser (sets up fixtures, skips RLS); app = like the API (RLS on).
export function pools(testDb: TestDb) {
  return {
    admin: new pg.Pool({ connectionString: testDb.adminUrl }),
    app: new pg.Pool({ connectionString: testDb.appUrl }),
  };
}

export const studentId = async (admin: pg.Pool, studentNo: string) =>
  (await admin.query('SELECT user_id FROM api.students WHERE student_no = $1', [studentNo])).rows[0].user_id as string;

// Runs `fn` in a transaction as this user (null = nobody), then rolls back,
// so a test that fails to block a write still leaves nothing behind.
export async function rolledBack<T>(pool: pg.Pool, userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

// A new section (in a term no other test file uses) with its own new
// instructor, these students, and one open check-in window in room F1.
// Its own instructor keeps it out of the seeded instructors' counts in other
// test files. Each file passes its own sectionNo, because test files run
// side by side.
export async function openWindowFor(admin: pg.Pool, sectionNo: number, students: string[]) {
  const instructor = (
    await admin.query(`INSERT INTO api.users (email, full_name) VALUES ($1, 'Y6 Teacher') RETURNING id`, [
      `y6-teacher-${sectionNo}@example.test`,
    ])
  ).rows[0].id as string;
  await admin.query(`INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'instructor')`, [instructor]);
  const section = (
    await admin.query(
      `INSERT INTO api.sections (course_id, term, section_no, instructor_id)
       VALUES ($1, '2026-5', $2, $3) RETURNING id`,
      [SEED.COURSE_D2, sectionNo, instructor],
    )
  ).rows[0].id as string;
  for (const s of students) await admin.query('INSERT INTO api.enrollments (section_id, student_id) VALUES ($1, $2)', [section, s]);
  const session = (
    await admin.query(
      `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by)
       SELECT $1, id, location, radius_m, $2 FROM api.rooms WHERE id = $3 RETURNING id`,
      [section, instructor, SEED.ROOM_F1],
    )
  ).rows[0].id as string;
  return { session, instructor };
}
