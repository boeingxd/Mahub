// Old bug 2: the GPS check was skipped by sending `lat: "x"`. It became NaN,
// and every comparison with NaN is false, so "too far away?" said no.
// Fix, twice: zod accepts only real numbers in range (api/src/checkin/routes.ts),
// and the database CHECKs refuse NaN, Infinity and impossible values, in case
// a bad number ever gets past the API.
import { afterAll, describe, expect, inject, it } from 'vitest';
import { CheckinBody } from '../../src/checkin/routes.js';
import { pools, rolledBack, SEED } from './helpers.js';

const testDb = inject('testDb');
const GOOD = { lat: 14.07, lng: 100.6, accuracy: 10 };

describe('old bug 2: lat: "x" skips the GPS check (API)', () => {
  it('the check-in body accepts only finite numbers in range', () => {
    expect(CheckinBody.safeParse(GOOD).success).toBe(true);
    for (const lat of ['x', '14.07', NaN, Infinity, null, 91, -91]) {
      expect(CheckinBody.safeParse({ ...GOOD, lat }).success, String(lat)).toBe(false);
    }
    for (const accuracy of [NaN, -1, 5001, '10']) {
      expect(CheckinBody.safeParse({ ...GOOD, accuracy }).success, String(accuracy)).toBe(false);
    }
  });
  // The full request (`lat: "x"` → 400) is in test/checkin.test.ts.
});

describe.skipIf(!testDb)('old bug 2: lat: "x" skips the GPS check (database)', () => {
  const { admin, app } = testDb ? pools(testDb) : ({} as ReturnType<typeof pools>);
  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  // Tries to log a check-in attempt with these numbers, as the superuser
  // (so only the CHECK constraints can stop it), in a closed window that is
  // rolled back afterwards.
  const logAttempt = (distance: number | string, accuracy: number | string) =>
    rolledBack(admin, null, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
         SELECT '00000000-0000-0000-0000-0000000000e1', id, location, radius_m, $1, now() - interval '1 hour', now()
         FROM api.rooms WHERE id = $2 RETURNING id`,
        [SEED.INSTRUCTOR_1, SEED.ROOM_F1],
      );
      await c.query(
        `INSERT INTO api.checkin_attempts (class_session_id, user_id, outcome, distance_m, gps_accuracy_m)
         VALUES ($1, $2, 'ok', $3::real, $4::real)`,
        [rows[0].id, SEED.ADMIN, distance, accuracy],
      );
      await c.query(
        `INSERT INTO api.attendance (class_session_id, student_id, method, distance_m, gps_accuracy_m)
         SELECT $1, user_id, 'qr', $2::real, $3::real FROM api.students LIMIT 1`,
        [rows[0].id, distance, accuracy],
      );
    });

  it('accepts real values', async () => {
    await expect(logAttempt(12.5, 8)).resolves.toBeUndefined();
  });

  it('refuses NaN and Infinity (they pass a plain ">= 0" check)', async () => {
    await expect(logAttempt('NaN', 8)).rejects.toThrow(/check constraint/);
    await expect(logAttempt('Infinity', 8)).rejects.toThrow(/check constraint/);
    await expect(logAttempt(12.5, 'NaN')).rejects.toThrow(/check constraint/);
  });

  it('refuses a negative distance and an accuracy outside 0..5000', async () => {
    await expect(logAttempt(-1, 8)).rejects.toThrow(/check constraint/);
    await expect(logAttempt(12.5, -1)).rejects.toThrow(/check constraint/);
    await expect(logAttempt(12.5, 5001)).rejects.toThrow(/check constraint/);
  });
});
