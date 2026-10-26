// Old bug 4: one check-in counted twice when two requests arrived at once.
// Both read "not checked in yet", then both inserted.
// Fix: PRIMARY KEY (class_session_id, student_id) plus INSERT … ON CONFLICT
// DO NOTHING, inside one transaction (api/src/checkin/checkinStore.ts).
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createCheckinStore } from '../../src/checkin/checkinStore.js';
import { openWindowFor, pools, studentId } from './helpers.js';

const testDb = inject('testDb');

describe.skipIf(!testDb)('old bug 4: one check-in counted twice', () => {
  const { admin, app } = testDb ? pools(testDb) : ({} as ReturnType<typeof pools>);
  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('ten check-ins at the same moment give exactly one attendance row', async () => {
    const student = await studentId(admin, '6722780026');
    const { session } = await openWindowFor(admin, 504, [student]);
    const store = createCheckinStore(app);
    // Standing in room F1 (db/seeds/seed.sql).
    const here = { lat: 14.069, lng: 100.615, accuracy: 10 };

    const results = await Promise.all(Array.from({ length: 10 }, () => store.complete(student, session, here)));

    expect(results.filter((r) => r.outcome === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'already_present')).toHaveLength(9);
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM api.attendance WHERE class_session_id = $1', [session]);
    expect(rows[0].n).toBe(1);
  });
});
