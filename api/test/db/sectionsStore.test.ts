// Opening and closing check-in windows (task P3) against the real database:
// the SQL really runs, and row-level security really applies, because every
// call goes through `mahub_test_app` (a member of app_rw, like the API's user).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSectionsStore, type SectionsStore } from '../../src/sections/sectionsStore.js';

const testDb = inject('testDb');

// Fixed ids from db/seeds/seed.sql.
const INSTRUCTOR_1 = '00000000-0000-0000-0000-0000000000b1';
const INSTRUCTOR_2 = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const COURSE_D2 = '00000000-0000-0000-0000-0000000000d2';

describe.skipIf(!testDb)('open and close check-in windows', () => {
  let admin: pg.Pool; // superuser: sets up fixtures
  let app: pg.Pool; // like the API: RLS applies
  let store: SectionsStore;
  let student: string;
  let room: string;
  let nextSectionNo = 100;

  // Each test gets its own brand-new section, so tests never share an open
  // window (only one is allowed per section) and don't depend on each other.
  // Term 2026-2 keeps these away from the sections other test files use.
  async function newSection(instructor = INSTRUCTOR_1): Promise<string> {
    const { rows } = await admin.query(
      `INSERT INTO api.sections (course_id, term, section_no, instructor_id)
       VALUES ($1, '2026-2', $2, $3) RETURNING id`,
      [COURSE_D2, nextSectionNo++, instructor],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testDb!.adminUrl });
    app = new pg.Pool({ connectionString: testDb!.appUrl });
    store = createSectionsStore(app);
    student = (await admin.query(`SELECT user_id FROM api.students WHERE student_no = '6722780001'`)).rows[0].user_id;
    // Our own room, so changing it below can't disturb other test files.
    room = (
      await admin.query(
        `INSERT INTO api.rooms (name, location, radius_m)
         VALUES ('P3 test room', ST_SetSRID(ST_MakePoint(100.6, 14.07), 4326)::geography, 50) RETURNING id`,
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('opening a window copies the room location and radius (snapshot)', async () => {
    const section = await newSection();
    const opened = await store.open(INSTRUCTOR_1, section, room);
    expect(opened).toMatchObject({ ok: true, session: { section_id: section, room_id: room, radius_m: 50 } });
    if (!opened.ok) throw new Error('unreachable');
    expect(opened.session).toMatchObject({ opened_by: INSTRUCTOR_1, closed_at: null });

    // Move and resize the room afterwards: the window keeps what it had.
    await admin.query(
      `UPDATE api.rooms SET radius_m = 99, location = ST_SetSRID(ST_MakePoint(101, 15), 4326)::geography WHERE id = $1`,
      [room],
    );
    const { rows } = await admin.query(
      `SELECT radius_m, ST_AsText(location::geometry) AS wkt FROM api.class_sessions WHERE id = $1`,
      [opened.session.id],
    );
    expect(rows[0]).toEqual({ radius_m: 50, wkt: 'POINT(100.6 14.07)' });
    await admin.query(
      `UPDATE api.rooms SET radius_m = 50, location = ST_SetSRID(ST_MakePoint(100.6, 14.07), 4326)::geography WHERE id = $1`,
      [room],
    );
  });

  it('a second open window for the same section is refused', async () => {
    const section = await newSection();
    expect((await store.open(INSTRUCTOR_1, section, room)).ok).toBe(true);
    expect(await store.open(INSTRUCTOR_1, section, room)).toEqual({ ok: false, error: 'SESSION_ALREADY_OPEN' });
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.class_sessions WHERE section_id = $1', [section]);
    expect(rows[0].n).toBe(1);
  });

  it("another instructor can't open, read or close a window in this section", async () => {
    const section = await newSection(INSTRUCTOR_1);
    const opened = await store.open(INSTRUCTOR_1, section, room);
    if (!opened.ok) throw new Error('setup failed');
    const id = opened.session.id;

    expect(await store.open(INSTRUCTOR_2, section, room)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.get(INSTRUCTOR_2, id)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.close(INSTRUCTOR_2, id)).toEqual({ ok: false, error: 'FORBIDDEN' });

    // ...and it's still open: the failed close changed nothing.
    const { rows } = await admin.query('SELECT closed_at FROM api.class_sessions WHERE id = $1', [id]);
    expect(rows[0].closed_at).toBeNull();
  });

  it("a student can't open, read or close a window (old bug 3 family)", async () => {
    const section = await newSection();
    const opened = await store.open(INSTRUCTOR_1, section, room);
    if (!opened.ok) throw new Error('setup failed');
    const id = opened.session.id;

    // A second section with no open window, to try opening in.
    const other = await newSection();
    expect(await store.open(student, other, room)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.get(student, id)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.close(student, id)).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('an admin who is not that section\'s instructor is also refused (ownership, not just a role)', async () => {
    const section = await newSection();
    expect(await store.open(ADMIN, section, room)).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('a section that does not exist looks the same as one that is not yours', async () => {
    const missing = '11111111-1111-1111-1111-111111111111';
    expect(await store.open(INSTRUCTOR_1, missing, room)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.get(INSTRUCTOR_1, missing)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await store.close(INSTRUCTOR_1, missing)).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('an unknown room is refused, and nothing is created', async () => {
    const section = await newSection();
    expect(await store.open(INSTRUCTOR_1, section, '22222222-2222-2222-2222-222222222222')).toEqual({
      ok: false,
      error: 'ROOM_NOT_FOUND',
    });
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.class_sessions WHERE section_id = $1', [section]);
    expect(rows[0].n).toBe(0);
  });

  it('closing sets closed_at, and then a new window can be opened', async () => {
    const section = await newSection();
    const first = await store.open(INSTRUCTOR_1, section, room);
    if (!first.ok) throw new Error('setup failed');

    const closed = await store.close(INSTRUCTOR_1, first.session.id);
    expect(closed).toMatchObject({ ok: true, session: { id: first.session.id } });
    if (!closed.ok) throw new Error('unreachable');
    expect(closed.session.closed_at).toBeInstanceOf(Date);

    // Closing twice is reported, not repeated.
    expect(await store.close(INSTRUCTOR_1, first.session.id)).toEqual({ ok: false, error: 'SESSION_CLOSED' });

    const second = await store.open(INSTRUCTOR_1, section, room);
    expect(second).toMatchObject({ ok: true });
    if (second.ok) expect(second.session.id).not.toBe(first.session.id);
  });

  it('get returns the window for its instructor', async () => {
    const section = await newSection();
    const opened = await store.open(INSTRUCTOR_1, section, room);
    if (!opened.ok) throw new Error('setup failed');
    expect(await store.get(INSTRUCTOR_1, opened.session.id)).toEqual(opened);
  });

  it('my sections: only mine, with the enrolled count and the open window', async () => {
    const mine = await newSection(INSTRUCTOR_1);
    const theirs = await newSection(INSTRUCTOR_2);
    await admin.query('INSERT INTO api.enrollments (section_id, student_id) VALUES ($1, $2)', [mine, student]);

    let sections = await store.listMine(INSTRUCTOR_1);
    expect(sections.find((s) => s.id === theirs)).toBeUndefined();
    expect(sections.find((s) => s.id === mine)).toMatchObject({
      course_code: 'ITS323',
      course_name: 'Computer Networks',
      term: '2026-2',
      enrolled: 1,
      open_session_id: null,
    });

    const opened = await store.open(INSTRUCTOR_1, mine, room);
    if (!opened.ok) throw new Error('setup failed');
    sections = await store.listMine(INSTRUCTOR_1);
    expect(sections.find((s) => s.id === mine)?.open_session_id).toBe(opened.session.id);

    // A student has no sections to teach.
    expect(await store.listMine(student)).toEqual([]);
  });
});
