// Rosters, attendance rates and manual marks (task P4) against the real
// database: the two views really run, and row-level security really applies,
// because every call goes through `mahub_test_app` (a member of app_rw, like
// the API's own user).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createReportsStore, type ReportsStore } from '../../src/reports/reportsStore.js';

const testDb = inject('testDb');

const INSTRUCTOR_2 = '00000000-0000-0000-0000-0000000000b2'; // seeded; teaches nothing of ours
const COURSE_D2 = '00000000-0000-0000-0000-0000000000d2';

describe.skipIf(!testDb)('rosters, rates and manual marks', () => {
  let admin: pg.Pool; // superuser: sets up fixtures
  let app: pg.Pool; // like the API: RLS applies
  let store: ReportsStore;
  let teacher: string; // our own instructor, so counts in other test files stay unchanged
  let room: string;
  let nextSectionNo = 200;

  const idOf = async (studentNo: string) =>
    (await admin.query('SELECT user_id FROM api.students WHERE student_no = $1', [studentNo])).rows[0].user_id as string;

  // Each test builds its own section, so tests never share rows. Students
  // 6722780010..14 are used by no other test file.
  async function fixture(studentNos: string[], sessions: { open?: boolean }[]) {
    const section = (
      await admin.query(
        `INSERT INTO api.sections (course_id, term, section_no, instructor_id)
         VALUES ($1, '2026-3', $2, $3) RETURNING id`,
        [COURSE_D2, nextSectionNo++, teacher],
      )
    ).rows[0].id as string;
    for (const no of studentNos) {
      await admin.query('INSERT INTO api.enrollments (section_id, student_id) VALUES ($1, $2)', [section, await idOf(no)]);
    }
    const ids: string[] = [];
    for (const [i, s] of sessions.entries()) {
      const daysAgo = sessions.length - i + 1;
      ids.push(
        (
          await admin.query(
            `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
             SELECT $1, id, location, radius_m, $2, now() - make_interval(days => $4),
                    CASE WHEN $5::boolean THEN NULL ELSE now() - make_interval(days => $4) + interval '1 hour' END
             FROM api.rooms WHERE id = $3 RETURNING id`,
            [section, teacher, room, daysAgo, s.open ?? false],
          )
        ).rows[0].id,
      );
    }
    return { section, ids };
  }

  const attend = async (session: string, studentNo: string, status: 'present' | 'excused', method: 'qr' | 'manual') =>
    admin.query(
      `INSERT INTO api.attendance (class_session_id, student_id, status, method, recorded_by, distance_m, gps_accuracy_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [session, await idOf(studentNo), status, method, method === 'manual' ? teacher : null, method === 'qr' ? 12 : null, method === 'qr' ? 8 : null],
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
    store = createReportsStore(app);
    teacher = (
      await admin.query(`INSERT INTO api.users (email, full_name) VALUES ('p4-teacher@example.test', 'P4 Teacher') RETURNING id`)
    ).rows[0].id;
    await admin.query(`INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'instructor')`, [teacher]);
    room = (
      await admin.query(
        `INSERT INTO api.rooms (name, location, radius_m)
         VALUES ('P4 test room', ST_SetSRID(ST_MakePoint(100.6, 14.07), 4326)::geography, 50) RETURNING id`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  // ---- the roster: absent is worked out, never stored ---------------------

  it('the roster shows the right present / excused / absent mix', async () => {
    const { ids } = await fixture(['6722780010', '6722780011', '6722780012', '6722780013'], [{}]);
    await attend(ids[0]!, '6722780010', 'present', 'qr');
    await attend(ids[0]!, '6722780011', 'excused', 'manual');

    const res = await store.roster(teacher, ids[0]!);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.roster.counts).toEqual({ enrolled: 4, present: 1, excused: 1, absent: 2 });
    expect(res.roster.students.map((s) => [s.student_no, s.status, s.method])).toEqual([
      ['6722780010', 'present', 'qr'],
      ['6722780011', 'excused', 'manual'],
      ['6722780012', 'absent', null],
      ['6722780013', 'absent', null],
    ]);
    expect(res.roster.students[0]!.recorded_at).toBeInstanceOf(Date);
    expect(res.roster.students[2]!.recorded_at).toBeNull();

    // "Absent" was derived: no attendance row exists for those two.
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.attendance WHERE class_session_id = $1', [ids[0]]);
    expect(rows[0].n).toBe(2);
  });

  it('a class with nobody enrolled has an empty roster, not an error', async () => {
    const { ids } = await fixture([], [{}]);
    expect(await store.roster(teacher, ids[0]!)).toMatchObject({
      ok: true,
      roster: { counts: { enrolled: 0, present: 0, excused: 0, absent: 0 }, students: [] },
    });
  });

  it('the roster view has no risk-flag column (there are no flags, ADR 0008)', async () => {
    const { rows } = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'api' AND table_name = 'v_session_roster' ORDER BY ordinal_position`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toEqual(
      expect.arrayContaining(['class_session_id', 'student_id', 'student_no', 'full_name', 'status', 'method', 'recorded_at']),
    );
    expect(columns.join(',')).not.toMatch(/risk|flag/);
  });

  // ---- the rate view ------------------------------------------------------

  it('the report gives each student their attendance rate, and excused sessions do not count against them', async () => {
    const { section, ids } = await fixture(['6722780010', '6722780011', '6722780012', '6722780013'], [{}, {}]);
    await attend(ids[0]!, '6722780010', 'present', 'qr');
    await attend(ids[1]!, '6722780010', 'present', 'qr');
    await attend(ids[0]!, '6722780011', 'excused', 'manual');
    await attend(ids[1]!, '6722780011', 'present', 'qr'); // excused once, came to the other
    await attend(ids[1]!, '6722780012', 'present', 'qr');

    const res = await store.report(teacher, section);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.rows.map((r) => [r.student_no, r.sessions_held, r.attended, r.excused, r.rate_pct])).toEqual([
      ['6722780010', 2, 2, 0, 100], // came to both
      ['6722780011', 2, 1, 1, 100], // excused once: only 1 session counts, and they came to it (not 50%)
      ['6722780012', 2, 1, 0, 50],
      ['6722780013', 2, 0, 0, 0],
    ]);
    expect(typeof res.rows[0]!.rate_pct).toBe('number'); // not the string pg gives for numeric
  });

  it('with nothing to divide by, the rate is empty (null), not 0 or an error', async () => {
    const none = await fixture(['6722780010'], []); // no windows held yet
    const noneRes = await store.report(teacher, none.section);
    expect(noneRes).toMatchObject({ ok: true, rows: [{ sessions_held: 0, attended: 0, rate_pct: null }] });

    const excused = await fixture(['6722780010'], [{}]); // the only window: excused
    await attend(excused.ids[0]!, '6722780010', 'excused', 'manual');
    expect(await store.report(teacher, excused.section)).toMatchObject({
      ok: true,
      rows: [{ sessions_held: 1, excused: 1, rate_pct: null }],
    });
  });

  // ---- who may read: the views respect row-level security -----------------

  it("a student can't read another student's row, or another section's roster, through the views", async () => {
    const { section, ids } = await fixture(['6722780010', '6722780011'], [{}]);
    await attend(ids[0]!, '6722780010', 'present', 'qr');
    const s10 = await idOf('6722780010');
    const s11 = await idOf('6722780011');
    const outsider = await idOf('6722780014'); // not in this section

    // Each student sees only their own line.
    const mine = await asUser(s10, async (c) =>
      (await c.query('SELECT student_id FROM api.v_session_roster WHERE class_session_id = $1', [ids[0]])).rows,
    );
    expect(mine).toEqual([{ student_id: s10 }]);
    const theirs = await asUser(s11, async (c) =>
      (await c.query('SELECT student_id FROM api.v_section_attendance_rate WHERE section_id = $1', [section])).rows,
    );
    expect(theirs).toEqual([{ student_id: s11 }]);

    // A student from outside the section, an unrelated instructor and "nobody" see nothing.
    for (const who of [outsider, INSTRUCTOR_2, null]) {
      const rows = await asUser(who, async (c) => [
        ...(await c.query('SELECT 1 FROM api.v_session_roster WHERE class_session_id = $1', [ids[0]])).rows,
        ...(await c.query('SELECT 1 FROM api.v_section_attendance_rate WHERE section_id = $1', [section])).rows,
      ]);
      expect(rows, String(who)).toEqual([]);
    }

    // The section's own instructor sees everyone.
    const all = await asUser(teacher, async (c) =>
      (await c.query('SELECT 1 FROM api.v_session_roster WHERE class_session_id = $1', [ids[0]])).rowCount,
    );
    expect(all).toBe(2);
  });

  it("another instructor and a student are refused by the store (403 FORBIDDEN), and so is a window that doesn't exist", async () => {
    const { section, ids } = await fixture(['6722780010'], [{}]);
    const student = await idOf('6722780010');
    const missing = '33333333-3333-3333-3333-333333333333';
    for (const who of [INSTRUCTOR_2, student]) {
      expect(await store.roster(who, ids[0]!)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await store.report(who, section)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await store.mark(who, ids[0]!, student, 'present')).toEqual({ ok: false, error: 'FORBIDDEN' });
    }
    expect(await store.roster(teacher, missing)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.report(teacher, missing)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.mark(teacher, missing, student, 'present')).toEqual({ ok: false, error: 'FORBIDDEN' });

    // The refused marks changed nothing.
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.attendance WHERE class_session_id = $1', [ids[0]]);
    expect(rows[0].n).toBe(0);
  });

  // ---- manual marks -------------------------------------------------------

  it('marks an absent student excused, signed by the instructor, and the roster shows it', async () => {
    const { ids } = await fixture(['6722780010', '6722780011'], [{}]);
    const student = await idOf('6722780011');

    const res = await store.mark(teacher, ids[0]!, student, 'excused');
    expect(res).toMatchObject({
      ok: true,
      attendance: { class_session_id: ids[0], student_id: student, status: 'excused', method: 'manual', recorded_by: teacher },
    });

    const roster = await store.roster(teacher, ids[0]!);
    if (!roster.ok) throw new Error('unreachable');
    expect(roster.roster.counts).toMatchObject({ excused: 1, absent: 1 });
  });

  it('replaces a QR check-in with the manual mark, and drops the old distance', async () => {
    const { ids } = await fixture(['6722780010'], [{}]);
    await attend(ids[0]!, '6722780010', 'present', 'qr'); // has distance_m 12, gps_accuracy_m 8
    const student = await idOf('6722780010');

    expect(await store.mark(teacher, ids[0]!, student, 'excused')).toMatchObject({
      ok: true,
      attendance: { status: 'excused', method: 'manual', recorded_by: teacher },
    });
    const { rows } = await admin.query(
      'SELECT status, method, recorded_by, distance_m, gps_accuracy_m FROM api.attendance WHERE class_session_id = $1',
      [ids[0]],
    );
    expect(rows).toEqual([{ status: 'excused', method: 'manual', recorded_by: teacher, distance_m: null, gps_accuracy_m: null }]);
  });

  it('marking the same student twice is fine and leaves one row', async () => {
    const { ids } = await fixture(['6722780010'], [{}]);
    const student = await idOf('6722780010');
    expect((await store.mark(teacher, ids[0]!, student, 'present')).ok).toBe(true);
    expect((await store.mark(teacher, ids[0]!, student, 'present')).ok).toBe(true);
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.attendance WHERE class_session_id = $1', [ids[0]]);
    expect(rows[0].n).toBe(1);
  });

  it('works on an open window as well as a closed one', async () => {
    const { ids } = await fixture(['6722780010'], [{ open: true }]);
    expect((await store.mark(teacher, ids[0]!, await idOf('6722780010'), 'present')).ok).toBe(true);
  });

  it('refuses a student who is not enrolled in the section, and creates nothing', async () => {
    const { ids } = await fixture(['6722780010'], [{}]);
    const outsider = await idOf('6722780014');
    expect(await store.mark(teacher, ids[0]!, outsider, 'present')).toEqual({ ok: false, error: 'NOT_ENROLLED' });
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.attendance WHERE class_session_id = $1', [ids[0]]);
    expect(rows[0].n).toBe(0);
  });
});
