// Old bug 3: any student could create a class.
// Fix: every write checks role AND ownership with RLS. Only an admin creates
// sections, and only a section's instructor opens its check-in windows.
// More in test/db/rls.test.ts and test/db/sectionsStore.test.ts.
import { afterAll, describe, expect, inject, it } from 'vitest';
import { pools, rolledBack, SEED, studentId } from './helpers.js';

const testDb = inject('testDb');

describe.skipIf(!testDb)('old bug 3: a student creates a class', () => {
  const { admin, app } = testDb ? pools(testDb) : ({} as ReturnType<typeof pools>);
  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('a student cannot create a section', async () => {
    const me = await studentId(admin, '6722780025');
    await expect(
      rolledBack(app, me, (c) =>
        c.query(`INSERT INTO api.sections (course_id, term, section_no, instructor_id) VALUES ($1, '2026-5', 900, $2)`, [
          SEED.COURSE_D1,
          me,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a student cannot open a check-in window for a section they are in', async () => {
    const me = await studentId(admin, '6722780025'); // enrolled in section e1
    await expect(
      rolledBack(app, me, (c) =>
        c.query(
          `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
           VALUES ('00000000-0000-0000-0000-0000000000e1', $1, ST_SetSRID(ST_MakePoint(100.6, 14.07), 4326)::geography,
                   50, $2, now() - interval '1 hour', now())`,
          [SEED.ROOM_F1, me],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
