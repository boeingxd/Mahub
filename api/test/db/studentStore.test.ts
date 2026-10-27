// The student endpoints (task B6) against the real database: the views really
// run, and row-level security really applies, because every call goes
// through `mahub_test_app` (a member of app_rw, like the API's own user).
// Every test makes its own students, so seeded enrollments never leak in.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createStudentStore, type StudentStore } from '../../src/student/studentStore.js';

const testDb = inject('testDb');

const COURSE_D2 = '00000000-0000-0000-0000-0000000000d2';

describe.skipIf(!testDb)('student classes, overview and class detail', () => {
  let admin: pg.Pool; // superuser: sets up fixtures
  let app: pg.Pool; // like the API: RLS applies
  let store: StudentStore;
  let teacher: string;
  let room: string;
  let nextSectionNo = 500;
  let nextStudentNo = 9920000000;

  async function newStudent(): Promise<string> {
    const no = String(nextStudentNo++);
    const id = (
      await admin.query(`INSERT INTO api.users (email, full_name) VALUES ($1, $2) RETURNING id`, [
        `b6-${no}@example.test`,
        `B6 Student ${no}`,
      ])
    ).rows[0].id as string;
    await admin.query('INSERT INTO api.students (user_id, student_no) VALUES ($1, $2)', [id, no]);
    return id;
  }

  // A section with these students enrolled and some windows, oldest first.
  // A window is closed unless `open` is set.
  async function section(students: string[], windows: { open?: boolean }[]) {
    const id = (
      await admin.query(
        `INSERT INTO api.sections (course_id, term, section_no, instructor_id)
         VALUES ($1, '2026-3', $2, $3) RETURNING id`,
        [COURSE_D2, nextSectionNo++, teacher],
      )
    ).rows[0].id as string;
    for (const s of students) await admin.query('INSERT INTO api.enrollments (section_id, student_id) VALUES ($1, $2)', [id, s]);
    const ids: string[] = [];
    for (const [i, w] of windows.entries()) {
      const daysAgo = windows.length - i + 1;
      ids.push(
        (
          await admin.query(
            `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
             SELECT $1, id, location, radius_m, $2, now() - make_interval(days => $4),
                    CASE WHEN $5::boolean THEN NULL ELSE now() - make_interval(days => $4) + interval '1 hour' END
             FROM api.rooms WHERE id = $3 RETURNING id`,
            [id, teacher, room, daysAgo, w.open ?? false],
          )
        ).rows[0].id,
      );
    }
    return { id, windows: ids };
  }

  const attend = (window: string, student: string, status: 'present' | 'excused', method: 'qr' | 'manual', minutesAgo = 0) =>
    admin.query(
      `INSERT INTO api.attendance (class_session_id, student_id, status, method, recorded_by, distance_m, gps_accuracy_m, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(mins => $8))`,
      [window, student, status, method, method === 'manual' ? teacher : null, method === 'qr' ? 12 : null, method === 'qr' ? 8 : null, minutesAgo],
    );

  // Runs `fn` as this user through the app role (RLS on), then rolls back.
  async function asUser<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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
    store = createStudentStore(app);
    teacher = (
      await admin.query(`INSERT INTO api.users (email, full_name) VALUES ('b6-teacher@example.test', 'B6 Teacher') RETURNING id`)
    ).rows[0].id;
    await admin.query(`INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'instructor')`, [teacher]);
    room = (
      await admin.query(
        `INSERT INTO api.rooms (name, location, radius_m)
         VALUES ('B6 test room', ST_SetSRID(ST_MakePoint(100.6, 14.07), 4326)::geography, 50) RETURNING id`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  // ---- my classes ---------------------------------------------------------

  it('my classes shows my rate, and an excused window is taken out of the bottom line', async () => {
    const me = await newStudent();
    const s = await section([me], [{}, {}, {}, {}]);
    await attend(s.windows[0]!, me, 'present', 'qr');
    await attend(s.windows[1]!, me, 'present', 'qr');
    await attend(s.windows[2]!, me, 'excused', 'manual');
    // window 3: absent (no row)

    const rows = await store.classes(me);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      section_id: s.id,
      course_code: expect.any(String),
      course_name: expect.any(String),
      term: '2026-3',
      sessions_held: 4,
      attended: 2,
      excused: 1,
      sessions_counted: 3, // held - excused: exactly what the rate divides by
      rate_pct: 66.7,
    });
    expect(typeof rows[0]!.rate_pct).toBe('number'); // not the string pg gives for numeric
  });

  it('with nothing to divide by the rate is null, not 0', async () => {
    const me = await newStudent();
    await section([me], []); // no windows yet
    const onlyExcused = await newStudent();
    const s = await section([onlyExcused], [{}]);
    await attend(s.windows[0]!, onlyExcused, 'excused', 'manual');

    expect(await store.classes(me)).toMatchObject([{ sessions_held: 0, sessions_counted: 0, rate_pct: null }]);
    expect(await store.classes(onlyExcused)).toMatchObject([
      { sessions_held: 1, excused: 1, sessions_counted: 0, rate_pct: null },
    ]);
  });

  it('a still-open window counts in "held"', async () => {
    const me = await newStudent();
    const s = await section([me], [{}, { open: true }]);
    await attend(s.windows[0]!, me, 'present', 'qr');
    expect(await store.classes(me)).toMatchObject([{ sessions_held: 2, attended: 1, rate_pct: 50 }]);
  });

  it('I only see my own classes and my own numbers', async () => {
    const me = await newStudent();
    const other = await newStudent();
    const mine = await section([me, other], [{}]);
    await section([other], [{}]); // not mine
    await attend(mine.windows[0]!, other, 'present', 'qr');

    const rows = await store.classes(me);
    expect(rows.map((r) => r.section_id)).toEqual([mine.id]);
    expect(rows[0]).toMatchObject({ attended: 0, rate_pct: 0 }); // the other student's check-in is not mine
  });

  it('someone enrolled in nothing (an instructor) gets an empty list', async () => {
    expect(await store.classes(teacher)).toEqual([]);
  });

  it('classes are sorted by course code, then section number', async () => {
    const me = await newStudent();
    const a = await section([me], []);
    const b = await section([me], []);
    const rows = await store.classes(me);
    expect(rows.map((r) => r.section_id)).toEqual([a.id, b.id]);
  });

  // ---- the instructor's name: a narrow SECURITY DEFINER function ----------

  it("an enrolled student sees the instructor's name, and only the name", async () => {
    const me = await newStudent();
    await section([me], []);
    expect(await store.classes(me)).toMatchObject([{ instructor_name: 'B6 Teacher' }]);
  });

  it("a student still can't read the instructor's users row directly", async () => {
    const me = await newStudent();
    await section([me], []);
    const rows = await asUser(me, async (c) => (await c.query('SELECT 1 FROM api.users WHERE id = $1', [teacher])).rows);
    expect(rows).toEqual([]);
  });

  it('the name function gives nothing for a section the caller is not enrolled in, or to nobody', async () => {
    const me = await newStudent();
    const outsider = await newStudent();
    const s = await section([me], []);
    const nameFor = async (who: string | null) =>
      asUser(who, async (c) => (await c.query('SELECT private.student_instructor_name($1) AS name', [s.id])).rows[0].name);
    expect(await nameFor(outsider)).toBeNull();
    expect(await nameFor(null)).toBeNull();
    expect(await nameFor(me)).toBe('B6 Teacher');
  });

  it('the name function is SECURITY DEFINER with a fixed search_path, owned by rls_definer, and not open to PUBLIC', async () => {
    const { rows } = await admin.query(
      `SELECT p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_run
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'private' AND p.proname = 'student_instructor_name'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ prosecdef: true, owner: 'rls_definer', public_can_run: false });
    expect(rows[0].proconfig).toContain('search_path=pg_catalog, private');
  });

  // ---- overview -----------------------------------------------------------

  it('the overall rate is pooled across classes, not the average of the class rates', async () => {
    const me = await newStudent();
    const small = await section([me], [{}, {}]); // 1 of 2 = 50%
    const big = await section([me], [{}, {}, {}, {}, {}, {}, {}, {}]); // 8 of 8 = 100%
    await attend(small.windows[0]!, me, 'present', 'qr');
    for (const w of big.windows) await attend(w, me, 'present', 'qr');
    const excusedHere = await section([me], [{}]);
    await attend(excusedHere.windows[0]!, me, 'excused', 'manual');

    const o = await store.overview(me);
    // 9 of 10 counted = 90%, not (50 + 100 + nothing) / 2
    expect(o.overall).toEqual({ sessions_held: 11, attended: 9, excused: 1, sessions_counted: 10, rate_pct: 90 });
    expect(o.classes).toHaveLength(3);
    expect(o.classes[0]).not.toHaveProperty('instructor_name');
    expect(o.classes[0]).not.toHaveProperty('term');
  });

  it('the overall rate is null with nothing to divide by', async () => {
    const me = await newStudent();
    expect((await store.overview(me)).overall).toEqual({
      sessions_held: 0,
      attended: 0,
      excused: 0,
      sessions_counted: 0,
      rate_pct: null,
    });
  });

  it('recent check-ins: my last 5 present rows, newest first; excused marks are not check-ins', async () => {
    const me = await newStudent();
    const other = await newStudent();
    const s = await section([me, other], [{}, {}, {}, {}, {}, {}, {}]);
    // window i is checked in (6 - i) * 10 minutes ago, so window 0 is the oldest
    for (const [i, w] of s.windows.slice(0, 6).entries()) await attend(w, me, 'present', i === 5 ? 'manual' : 'qr', (6 - i) * 10);
    await attend(s.windows[6]!, me, 'excused', 'manual', 1);
    await attend(s.windows[0]!, other, 'present', 'qr', 1); // someone else's, never mine

    const { recent_checkins: recent } = await store.overview(me);
    expect(recent.map((r) => r.class_session_id)).toEqual([5, 4, 3, 2, 1].map((i) => s.windows[i]));
    expect(recent[0]).toMatchObject({ method: 'manual', section_id: s.id });
    expect(recent[1]).toMatchObject({ method: 'qr' });
    expect(recent[0]!.recorded_at).toBeInstanceOf(Date);
  });

  // ---- class detail -------------------------------------------------------

  it('class detail lists every window newest first with present, excused and absent, and marks the open one', async () => {
    const me = await newStudent();
    const s = await section([me], [{}, {}, {}, { open: true }]);
    await attend(s.windows[0]!, me, 'present', 'qr');
    await attend(s.windows[1]!, me, 'excused', 'manual');

    const res = await store.classSessions(me, s.id);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.detail.class).toMatchObject({
      section_id: s.id,
      sessions_held: 4,
      attended: 1,
      excused: 1,
      sessions_counted: 3,
      instructor_name: 'B6 Teacher',
    });
    expect(res.detail.sessions.map((x) => [x.class_session_id, x.status, x.method, x.is_open])).toEqual([
      [s.windows[3], 'absent', null, true],
      [s.windows[2], 'absent', null, false],
      [s.windows[1], 'excused', 'manual', false],
      [s.windows[0], 'present', 'qr', false],
    ]);
    expect(res.detail.sessions[0]!.recorded_at).toBeNull();
    expect(res.detail.sessions[3]!.opened_at).toBeInstanceOf(Date);
  });

  it('a student of another section, an instructor and a missing id are all refused the same way (403)', async () => {
    const me = await newStudent();
    const outsider = await newStudent();
    const s = await section([me], [{}]);
    const missing = '33333333-3333-3333-3333-333333333333';
    expect(await store.classSessions(outsider, s.id)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.classSessions(teacher, s.id)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.classSessions(me, missing)).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  // ---- no GPS anywhere ----------------------------------------------------

  it('nothing the store returns has GPS, room coordinates or recorded_by, even when the row has them', async () => {
    const me = await newStudent();
    const s = await section([me], [{}]);
    await attend(s.windows[0]!, me, 'present', 'qr'); // stored with distance_m 12, accuracy 8
    const detail = await store.classSessions(me, s.id);
    const all = JSON.stringify([await store.classes(me), await store.overview(me), detail]);
    expect(all).not.toMatch(/distance|accuracy|gps|latitude|longitude|location|recorded_by/i);
  });

  it('the new views are security_invoker, so RLS applies through them', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'api' AND c.relname IN ('v_my_classes', 'v_my_overview', 'v_my_recent_checkins')`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(['v_my_classes', 'v_my_overview', 'v_my_recent_checkins']);
    for (const r of rows) expect(r.reloptions, r.relname).toContain('security_invoker=true');
  });
});
