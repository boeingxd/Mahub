// The student check-in transaction (task Y4) against the real database: the
// PostGIS distance really runs, and row-level security really applies,
// because every call goes through `mahub_test_app` (a member of app_rw, like
// the API's own user).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createCheckinStore, type CheckinStore } from '../../src/checkin/checkinStore.js';

const testDb = inject('testDb');

const INSTRUCTOR_1 = '00000000-0000-0000-0000-0000000000b1'; // seeded
const COURSE_D2 = '00000000-0000-0000-0000-0000000000d2';

// Our own room. The point is (longitude, latitude), like PostGIS wants it.
const ROOM_LNG = 100.6;
const ROOM_LAT = 14.07;
const RADIUS_M = 50;
// About 0.0001° of latitude is 11 m, so these are ~11 m and ~555 m north.
const NEAR = { lat: ROOM_LAT + 0.0001, lng: ROOM_LNG, accuracy: 10 };
const FAR = { lat: ROOM_LAT + 0.005, lng: ROOM_LNG, accuracy: 10 };

describe.skipIf(!testDb)('student check-in', () => {
  let admin: pg.Pool; // superuser: sets up fixtures and counts rows
  let app: pg.Pool; // like the API: RLS applies
  let store: CheckinStore;
  let room: string;
  let nextSectionNo = 400;

  const idOf = async (studentNo: string) =>
    (await admin.query('SELECT user_id FROM api.students WHERE student_no = $1', [studentNo])).rows[0].user_id as string;

  // Each test gets its own section and window, so tests never share rows.
  // Students 6722780020..24 are used by no other test file; term 2026-4
  // keeps these sections away from the other files' sections.
  async function openWindow(enrolled: string[], { closed = false } = {}) {
    const section = (
      await admin.query(
        `INSERT INTO api.sections (course_id, term, section_no, instructor_id)
         VALUES ($1, '2026-4', $2, $3) RETURNING id`,
        [COURSE_D2, nextSectionNo++, INSTRUCTOR_1],
      )
    ).rows[0].id as string;
    for (const no of enrolled) {
      await admin.query('INSERT INTO api.enrollments (section_id, student_id) VALUES ($1, $2)', [section, await idOf(no)]);
    }
    return (
      await admin.query(
        `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
         SELECT $1, id, location, radius_m, $2, now() - interval '1 hour',
                CASE WHEN $4::boolean THEN now() ELSE NULL END
         FROM api.rooms WHERE id = $3 RETURNING id`,
        [section, INSTRUCTOR_1, room, closed],
      )
    ).rows[0].id as string;
  }

  const attendance = async (session: string) =>
    (await admin.query('SELECT student_id, method, status, distance_m, gps_accuracy_m FROM api.attendance WHERE class_session_id = $1', [session])).rows;
  const attempts = async (session: string) =>
    (await admin.query('SELECT user_id, outcome, distance_m, gps_accuracy_m FROM api.checkin_attempts WHERE class_session_id = $1 ORDER BY at', [session])).rows;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testDb!.adminUrl });
    app = new pg.Pool({ connectionString: testDb!.appUrl });
    store = createCheckinStore(app);
    room = (
      await admin.query(
        `INSERT INTO api.rooms (name, location, radius_m)
         VALUES ('Y4 test room', ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3) RETURNING id`,
        [ROOM_LNG, ROOM_LAT, RADIUS_M],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('a student in the room is marked present, and the attempt is logged', async () => {
    const session = await openWindow(['6722780020']);
    const student = await idOf('6722780020');

    const result = await store.complete(student, session, NEAR);

    expect(result.outcome).toBe('ok');
    expect(result.distanceM).toBeGreaterThan(5);
    expect(result.distanceM).toBeLessThan(20);
    expect(await attendance(session)).toEqual([
      expect.objectContaining({ student_id: student, method: 'qr', status: 'present', gps_accuracy_m: 10 }),
    ]);
    expect(await attempts(session)).toEqual([expect.objectContaining({ user_id: student, outcome: 'ok' })]);
  });

  it('a student far away is refused, and the failed attempt is still logged', async () => {
    const session = await openWindow(['6722780020']);
    const student = await idOf('6722780020');

    const result = await store.complete(student, session, FAR);

    expect(result.outcome).toBe('out_of_range');
    expect(result.distanceM).toBeGreaterThan(500);
    expect(await attendance(session)).toEqual([]);
    expect(await attempts(session)).toEqual([expect.objectContaining({ user_id: student, outcome: 'out_of_range' })]);
  });

  it('poor GPS accuracy widens the circle, but by 30 m at most', async () => {
    const session = await openWindow(['6722780021', '6722780022']);
    // ~67 m away: outside the 50 m radius, inside 50 + 30.
    const edge = { lat: ROOM_LAT + 0.0006, lng: ROOM_LNG };

    expect((await store.complete(await idOf('6722780021'), session, { ...edge, accuracy: 5 })).outcome).toBe('out_of_range');
    expect((await store.complete(await idOf('6722780021'), session, { ...edge, accuracy: 30 })).outcome).toBe('ok');
    // Claiming 5 km accuracy doesn't let a student check in from far away.
    expect((await store.complete(await idOf('6722780022'), session, { ...FAR, accuracy: 5000 })).outcome).toBe('out_of_range');
  });

  it('a student who is not enrolled is refused and logged', async () => {
    const session = await openWindow(['6722780020']);
    const outsider = await idOf('6722780023');

    expect((await store.complete(outsider, session, NEAR)).outcome).toBe('not_enrolled');
    expect(await attendance(session)).toEqual([]);
    expect(await attempts(session)).toEqual([expect.objectContaining({ user_id: outsider, outcome: 'not_enrolled' })]);
  });

  it('a closed window is refused and logged', async () => {
    const session = await openWindow(['6722780020'], { closed: true });
    const student = await idOf('6722780020');

    expect((await store.complete(student, session, NEAR)).outcome).toBe('session_closed');
    expect(await attendance(session)).toEqual([]);
    expect(await attempts(session)).toEqual([expect.objectContaining({ outcome: 'session_closed' })]);
  });

  it('checking in twice gives ALREADY_PRESENT and keeps the first row', async () => {
    const session = await openWindow(['6722780020']);
    const student = await idOf('6722780020');

    expect((await store.complete(student, session, NEAR)).outcome).toBe('ok');
    expect((await store.complete(student, session, { ...NEAR, accuracy: 3 })).outcome).toBe('already_present');
    expect(await attendance(session)).toEqual([expect.objectContaining({ gps_accuracy_m: 10 })]);
  });

  // Old bug 4 (PROJECT_PLAN.md §2): two requests at the same moment both
  // passed the "already checked in?" check and both inserted a row.
  it('two check-ins at the same moment give exactly one attendance row', async () => {
    const session = await openWindow(['6722780024']);
    const student = await idOf('6722780024');

    const results = await Promise.all(Array.from({ length: 5 }, () => store.complete(student, session, NEAR)));

    expect(results.map((r) => r.outcome).sort()).toEqual(['already_present', 'already_present', 'already_present', 'already_present', 'ok']);
    expect(await attendance(session)).toHaveLength(1);
    expect(await attempts(session)).toHaveLength(5);
  });

  // ADR 0006: lat/lng are only used to compute a distance, never stored.
  it('no table in the api schema has a column for raw GPS or IP addresses', async () => {
    const { rows } = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'api' AND column_name ~* '(^|_)(lat|lng|lon|latitude|longitude|ip|ip_address)($|_)'`,
    );
    expect(rows).toEqual([]);
  });
});
