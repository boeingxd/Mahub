// Row-level security tests (task Y2), against a real database built by
// globalSetup.ts. Every query runs through `mahub_test_app`, a login user in
// app_rw exactly like the API's mahub_api, so the policies really apply.
// Each test runs inside a transaction that is rolled back, so tests can't
// affect each other.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createUserStore } from '../../src/auth/userStore.js';
import { assertRlsApplies } from '../../src/db.js';

const testDb = inject('testDb');

// Fixed ids from db/seeds/seed.sql.
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const INSTRUCTOR_1 = '00000000-0000-0000-0000-0000000000b1'; // teaches sections e1 and e3
const INSTRUCTOR_2 = '00000000-0000-0000-0000-0000000000b2'; // teaches section e2
const SECTION_E1 = '00000000-0000-0000-0000-0000000000e1'; // all 30 students
const COURSE_D1 = '00000000-0000-0000-0000-0000000000d1';
const ROOM_F1 = '00000000-0000-0000-0000-0000000000f1';

describe.skipIf(!testDb)('row-level security', () => {
  let admin: pg.Pool; // superuser: sets up fixtures
  let app: pg.Pool; // like the API: RLS applies
  let me: string; // Yayikast (6722781026), enrolled in e1
  let classmate: string; // 6722780001, enrolled in e1
  let openSession: string;
  let closedSession: string;

  const idOf = async (studentNo: string) =>
    (await admin.query('SELECT user_id FROM api.students WHERE student_no = $1', [studentNo])).rows[0].user_id as string;

  // Runs `fn` as this user (or as nobody), through the app user, then rolls back.
  async function as<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testDb!.adminUrl });
    app = new pg.Pool({ connectionString: testDb!.appUrl });
    me = await idOf('6722781026');
    classmate = await idOf('6722780001');

    // One open and one closed check-in window in section e1, and attendance
    // for two students in the open one.
    const open = await admin.query(
      `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by)
       SELECT $1, id, location, radius_m, $2 FROM api.rooms WHERE id = $3 RETURNING id`,
      [SECTION_E1, INSTRUCTOR_1, ROOM_F1],
    );
    openSession = open.rows[0].id;
    const closed = await admin.query(
      `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
       SELECT $1, id, location, radius_m, $2, now() - interval '2 days', now() - interval '1 day'
       FROM api.rooms WHERE id = $3 RETURNING id`,
      [SECTION_E1, INSTRUCTOR_1, ROOM_F1],
    );
    closedSession = closed.rows[0].id;
    await admin.query(
      `INSERT INTO api.attendance (class_session_id, student_id, method, distance_m, gps_accuracy_m)
       VALUES ($1, $2, 'qr', 12, 8), ($1, $3, 'qr', 20, 10)`,
      [openSession, me, classmate],
    );
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  // ---- the old app's bugs (PROJECT_PLAN.md §2) ----------------------------

  it('a student cannot make themselves admin (old bug 1)', async () => {
    await as(me, async (c) => {
      await expect(c.query(`INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'admin')`, [me])).rejects.toThrow(
        /row-level security/,
      );
    });
    // Changing their existing 'student' row into 'admin' doesn't work either:
    // no policy lets a student UPDATE user_roles, so 0 rows change.
    await as(me, async (c) => {
      const res = await c.query(`UPDATE api.user_roles SET role = 'admin' WHERE user_id = $1`, [me]);
      expect(res.rowCount).toBe(0);
    });
  });

  it('a student cannot create a section (old bug 3)', async () => {
    await as(me, async (c) => {
      await expect(
        c.query(`INSERT INTO api.sections (course_id, term, section_no, instructor_id) VALUES ($1, '2026-1', 9, $2)`, [
          COURSE_D1,
          me,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('an instructor cannot create a section either, only an admin can', async () => {
    const insert = (c: pg.PoolClient) =>
      c.query(`INSERT INTO api.sections (course_id, term, section_no, instructor_id) VALUES ($1, '2026-1', 9, $2)`, [
        COURSE_D1,
        INSTRUCTOR_1,
      ]);
    await as(INSTRUCTOR_1, async (c) => {
      await expect(insert(c)).rejects.toThrow(/row-level security/);
    });
    await as(ADMIN, async (c) => {
      await expect(insert(c)).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  // ---- who sees what ------------------------------------------------------

  it('a student sees only their own attendance', async () => {
    const rows = await as(me, async (c) => (await c.query('SELECT student_id FROM api.attendance')).rows);
    expect(rows).toEqual([{ student_id: me }]);
  });

  it("an instructor sees their own section's attendance, and nobody else's", async () => {
    const mine = await as(INSTRUCTOR_1, async (c) => (await c.query('SELECT * FROM api.attendance')).rows);
    expect(mine).toHaveLength(2);
    const other = await as(INSTRUCTOR_2, async (c) => (await c.query('SELECT * FROM api.attendance')).rows);
    expect(other).toHaveLength(0);
  });

  it('with no user id, nothing is visible (safe by default)', async () => {
    await as(null, async (c) => {
      for (const table of ['users', 'user_roles', 'students', 'sections', 'enrollments', 'attendance']) {
        expect((await c.query(`SELECT 1 FROM api.${table}`)).rowCount, table).toBe(0);
      }
    });
  });

  it('a student sees only themselves in users, an instructor sees their students', async () => {
    const forMe = await as(me, async (c) => (await c.query('SELECT id FROM api.users')).rows);
    expect(forMe).toEqual([{ id: me }]);
    const forInstructor = await as(INSTRUCTOR_1, async (c) => (await c.query('SELECT id FROM api.users')).rows);
    expect(forInstructor.length).toBeGreaterThanOrEqual(30); // their 30 students, plus themselves
  });

  // ---- writing attendance -------------------------------------------------

  it('a student can check in themselves, but not someone else', async () => {
    const classmate2 = await idOf('6722780002');
    await as(classmate2, async (c) => {
      const ok = await c.query(`INSERT INTO api.attendance (class_session_id, student_id, method) VALUES ($1, $2, 'qr')`, [
        openSession,
        classmate2,
      ]);
      expect(ok.rowCount).toBe(1);
    });
    await as(classmate2, async (c) => {
      const someoneElse = await idOf('6722780003');
      await expect(
        c.query(`INSERT INTO api.attendance (class_session_id, student_id, method) VALUES ($1, $2, 'qr')`, [
          openSession,
          someoneElse,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('a student cannot check in to a closed window, or mark themselves "manual" or "excused"', async () => {
    const classmate2 = await idOf('6722780002');
    const attempts = [
      [closedSession, 'qr', 'present'],
      [openSession, 'manual', 'present'],
      [openSession, 'qr', 'excused'],
    ];
    for (const [session, method, status] of attempts) {
      await as(classmate2, async (c) => {
        await expect(
          c.query(
            `INSERT INTO api.attendance (class_session_id, student_id, method, status, recorded_by) VALUES ($1, $2, $3, $4, $2)`,
            [session, classmate2, method, status],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    }
  });

  it('nobody can DELETE through the API user (no DELETE grant)', async () => {
    await as(ADMIN, async (c) => {
      await expect(c.query('DELETE FROM api.attendance')).rejects.toThrow(/permission denied/);
    });
  });

  // ---- sign-in (Y1) under RLS --------------------------------------------

  it('the login functions work before we know who the user is', async () => {
    await as(null, async (c) => {
      const found = await c.query('SELECT id FROM private.login_user_by_email($1)', ['6722781026@G.SIIT.TU.AC.TH']);
      expect(found.rows).toEqual([{ id: me }]);

      const created = await c.query(`SELECT id, google_sub FROM private.login_upsert_student($1, 'sub-new', 'New', $2)`, [
        '6799999999@g.siit.tu.ac.th',
        '6799999999',
      ]);
      expect(created.rows[0].google_sub).toBe('sub-new');

      // Now act as the new user (same transaction): they're a student, with
      // the student number taken from their email.
      await c.query("SELECT set_config('app.user_id', $1, true)", [created.rows[0].id]);
      const student = await c.query('SELECT student_no FROM api.students');
      expect(student.rows).toEqual([{ student_no: '6799999999' }]);
      const roles = await c.query('SELECT role, granted_by FROM api.user_roles');
      expect(roles.rows).toEqual([{ role: 'student', granted_by: null }]);
    });
  });

  it('the login functions refuse to create a student from a non-student email', async () => {
    await as(null, async (c) => {
      await expect(
        c.query(`SELECT * FROM private.login_upsert_student('evil@gmail.com', 'sub-x', 'Evil', '1234567890')`),
      ).rejects.toThrow(/not a SIIT student email/);
    });
    await as(null, async (c) => {
      // Right format, but the student number doesn't match the email.
      await expect(
        c.query(`SELECT * FROM private.login_upsert_student('6799999999@g.siit.tu.ac.th', 'sub-x', 'X', '6711111111')`),
      ).rejects.toThrow(/not a SIIT student email/);
    });
  });

  it('only the API role may call the login functions', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_ro');
      await expect(client.query(`SELECT * FROM private.login_user_by_email('x@y.z')`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it("the real user store (Y1) signs people in and reads their profile under RLS", async () => {
    const users = createUserStore(app);
    expect(await users.findByEmail('6722781026@g.siit.tu.ac.th')).toMatchObject({ id: me });
    expect(await users.getProfile(me)).toMatchObject({ id: me, roles: ['student'] });
    expect(await users.getProfile(INSTRUCTOR_1)).toMatchObject({ roles: ['instructor'] });
  });

  // ---- the API refuses to run as a superuser ------------------------------

  it('assertRlsApplies refuses a superuser and accepts the app user', async () => {
    await expect(assertRlsApplies(admin)).rejects.toThrow(/skips row-level security/);
    await expect(assertRlsApplies(app)).resolves.toBeUndefined();
  });
});
