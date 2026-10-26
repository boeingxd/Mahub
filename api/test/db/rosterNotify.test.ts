// Live roster trigger (task B5): writing attendance broadcasts on the "roster"
// channel. NOTIFY is only delivered on COMMIT, so this test commits real rows.
// Other test files share mahub_test and count rows in it, so this one builds a
// database of its own from the migrations and drops it at the end.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveBinary } from 'dbmate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const testDb = inject('testDb');

const DB = 'mahub_notify_test';
const inDb = (url: string) => {
  const u = new URL(url);
  u.pathname = `/${DB}`;
  return u.toString();
};

describe.skipIf(!testDb)('roster NOTIFY trigger', () => {
  let server: pg.Client; // connected to mahub_test, only used for CREATE/DROP DATABASE
  let admin: pg.Pool;
  let app: pg.Pool; // mahub_test_app: a member of app_rw, like the API
  let listener: pg.Client;
  let instructor: string;
  let session: string;
  let student: string;
  const heard: { class_session_id: string; student_id: string; status: string }[] = [];

  const waitFor = async (n: number) => {
    for (let i = 0; i < 50 && heard.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  };

  beforeAll(async () => {
    server = new pg.Client({ connectionString: testDb!.adminUrl });
    await server.connect();
    await server.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await server.query(`CREATE DATABASE ${DB}`);
    execFileSync(
      resolveBinary(),
      ['--url', inDb(testDb!.adminUrl), '--migrations-dir', resolve(import.meta.dirname, '../../../db/migrations'), '--no-dump-schema', 'up'],
      { stdio: 'pipe' },
    );

    admin = new pg.Pool({ connectionString: inDb(testDb!.adminUrl) });
    app = new pg.Pool({ connectionString: inDb(testDb!.appUrl) });
    const id = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows[0].id as string;
    instructor = await id(`INSERT INTO api.users (email, full_name) VALUES ('b5-instructor@example.test', 'B5 Instructor') RETURNING id`);
    student = await id(`INSERT INTO api.users (email, full_name) VALUES ('6799999999@g.siit.tu.ac.th', 'B5 Student') RETURNING id`);
    await admin.query(`INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'instructor'), ($2, 'student')`, [instructor, student]);
    await admin.query(`INSERT INTO api.students (user_id, student_no) VALUES ($1, '6799999999')`, [student]);
    const course = await id(`INSERT INTO api.courses (code, name) VALUES ('B5TEST', 'B5 test course') RETURNING id`);
    const section = await id(`INSERT INTO api.sections (course_id, term, section_no, instructor_id) VALUES ($1, '2026-1', 1, $2) RETURNING id`, [course, instructor]);
    await admin.query(`INSERT INTO api.enrollments (section_id, student_id) VALUES ($1, $2)`, [section, student]);
    const room = await id(
      `INSERT INTO api.rooms (name, location, radius_m) VALUES ('B5 room', ST_SetSRID(ST_MakePoint(100.615, 14.069), 4326)::geography, 50) RETURNING id`,
    );
    // A closed window in the past: the instructor can still write marks to it.
    session = await id(
      `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
       SELECT $1, id, location, radius_m, $2, now() - interval '3 days', now() - interval '2 days'
       FROM api.rooms WHERE id = $3 RETURNING id`,
      [section, instructor, room],
    );

    listener = new pg.Client({ connectionString: inDb(testDb!.appUrl) });
    await listener.connect();
    listener.on('notification', (m) => heard.push(JSON.parse(m.payload ?? '{}')));
    await listener.query('LISTEN roster');
  });

  afterAll(async () => {
    await listener?.end();
    await app?.end();
    await admin?.end();
    await server?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await server?.end();
  });

  // Runs as the instructor through the app user (RLS applies), then commits.
  async function asInstructor(sql: string, params: unknown[], end: 'COMMIT' | 'ROLLBACK' = 'COMMIT') {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id', $1, true)", [instructor]);
      await client.query(sql, params);
      await client.query(end);
    } finally {
      client.release();
    }
  }

  it('an insert through the app user is broadcast with ids and status only', async () => {
    await asInstructor(
      `INSERT INTO api.attendance (class_session_id, student_id, status, method, recorded_by) VALUES ($1, $2, 'present', 'manual', $3)`,
      [session, student, instructor],
    );
    await waitFor(1);
    expect(heard).toEqual([{ class_session_id: session, student_id: student, status: 'present' }]);
  });

  it('changing the status is broadcast too', async () => {
    await asInstructor(`UPDATE api.attendance SET status = 'excused' WHERE class_session_id = $1 AND student_id = $2`, [session, student]);
    await waitFor(2);
    expect(heard[1]).toEqual({ class_session_id: session, student_id: student, status: 'excused' });
  });

  it('a rolled-back write broadcasts nothing', async () => {
    const before = heard.length;
    await asInstructor(`UPDATE api.attendance SET status = 'present' WHERE class_session_id = $1 AND student_id = $2`, [session, student], 'ROLLBACK');
    await new Promise((r) => setTimeout(r, 300));
    expect(heard).toHaveLength(before);
  });
});
