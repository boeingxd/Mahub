// The QR store (task Y3) against the real database: only the section's
// instructor gets the projector QR, and a scan can check "is it open?"
// before the student has signed in.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createQrStore, type QrStore } from '../../src/checkin/qrStore.js';

const testDb = inject('testDb');

// Fixed ids from db/seeds/seed.sql. (rls.test.ts uses section e1, so this file
// uses e2 and e3: only one open window per section is allowed.)
const INSTRUCTOR_1 = '00000000-0000-0000-0000-0000000000b1'; // teaches e3
const INSTRUCTOR_2 = '00000000-0000-0000-0000-0000000000b2'; // teaches e2
const SECTION_E2 = '00000000-0000-0000-0000-0000000000e2';
const SECTION_E3 = '00000000-0000-0000-0000-0000000000e3';
const ROOM_F2 = '00000000-0000-0000-0000-0000000000f2';

describe.skipIf(!testDb)('QR store', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let store: QrStore;
  let open: string;
  let closed: string;
  let student: string;

  const newSession = async (section: string, instructor: string, closedAt: string | null) =>
    (
      await admin.query(
        `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
         SELECT $1, id, location, radius_m, $2, now() - interval '1 hour', $3::timestamptz
         FROM api.rooms WHERE id = $4 RETURNING id`,
        [section, instructor, closedAt, ROOM_F2],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testDb!.adminUrl });
    app = new pg.Pool({ connectionString: testDb!.appUrl });
    store = createQrStore(app);
    open = await newSession(SECTION_E2, INSTRUCTOR_2, null);
    closed = await newSession(SECTION_E3, INSTRUCTOR_1, new Date().toISOString());
    // A student enrolled in e2: RLS lets them see the window, but not get its QR.
    student = (
      await admin.query('SELECT student_id FROM api.enrollments WHERE section_id = $1 LIMIT 1', [SECTION_E2])
    ).rows[0].student_id;
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it("gives the window's state only to its own instructor", async () => {
    expect(await store.windowStateForInstructor(INSTRUCTOR_2, open)).toBe('open');
    expect(await store.windowStateForInstructor(INSTRUCTOR_1, closed)).toBe('closed');
    expect(await store.windowStateForInstructor(INSTRUCTOR_1, open)).toBeNull(); // not their section
    expect(await store.windowStateForInstructor(student, open)).toBeNull(); // enrolled, but not the instructor
  });

  it('a scan can check whether a window is open, before signing in', async () => {
    expect(await store.isOpen(open)).toBe(true);
    expect(await store.isOpen(closed)).toBe(false);
    expect(await store.isOpen('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
