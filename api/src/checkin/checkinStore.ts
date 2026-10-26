import type pg from 'pg';
import { withUser } from '../db.js';

// The student check-in (task Y4, PROJECT_PLAN.md §5.2). The client never
// writes attendance: it sends where it is, and the server decides.

// Where the phone says it is. Already checked by zod in routes.ts.
export interface Gps {
  lat: number; // −90..90
  lng: number; // −180..180
  accuracy: number; // metres, 0..5000
}

// The same names as the api.attempt_outcome enum, so they go straight into
// checkin_attempts.outcome. ('bad_qr' never reaches the store: a bad or old
// scan is refused in routes.ts before we know which window to log it under.)
export type CheckinOutcome = 'ok' | 'session_closed' | 'not_enrolled' | 'out_of_range' | 'already_present';

export interface CheckinResult {
  outcome: CheckinOutcome;
  distanceM: number | null; // null when we stopped before measuring
}

export interface CheckinStore {
  complete(userId: string, classSessionId: string, gps: Gps): Promise<CheckinResult>;
}

// A phone's accuracy figure widens the circle a little, but never by more
// than this. Otherwise "accuracy: 5000" would let anyone check in from home.
const MAX_ACCURACY_BONUS_M = 30;

export function createCheckinStore(pool: Pick<pg.Pool, 'connect'>): CheckinStore {
  return {
    async complete(userId, classSessionId, { lat, lng, accuracy }) {
      // One transaction (withUser = BEGIN ... COMMIT) as this student, so
      // row-level security applies to every query below. Refusals RETURN
      // instead of throwing: a throw would ROLLBACK and lose the log row.
      return withUser(pool, userId, async (client) => {
        const result = await decide(client, userId, classSessionId, { lat, lng, accuracy });

        // Step 5: ALWAYS log the attempt, failures included, so the
        // instructor (and we) can see who tried and why it was refused.
        // Only the distance and accuracy are kept, never lat/lng (ADR 0006).
        await client.query(
          `INSERT INTO api.checkin_attempts (class_session_id, user_id, outcome, distance_m, gps_accuracy_m)
           VALUES ($1, $2, $3, $4, $5)`,
          [classSessionId, userId, result.outcome, result.distanceM, accuracy],
        );
        return result;
      });
    },
  };
}

async function decide(client: pg.PoolClient, userId: string, classSessionId: string, { lat, lng, accuracy }: Gps): Promise<CheckinResult> {
  // Steps 1 and 2. A student who isn't enrolled can't even SELECT the window
  // (RLS hides it), so these two yes/no questions go through SECURITY
  // DEFINER helpers (db/migrations/*_qr.sql and *_rls.sql).
  const { rows: checks } = await client.query<{ open: boolean; can: boolean }>(
    'SELECT private.class_session_is_open($1) AS open, private.can_check_in($1) AS can',
    [classSessionId],
  );
  if (!checks[0]?.open) return { outcome: 'session_closed', distanceM: null };
  if (!checks[0].can) return { outcome: 'not_enrolled', distanceM: null };

  // Step 3: the geofence, computed by PostGIS inside the database.
  // ST_MakePoint takes (longitude, latitude): x before y. The ::geography
  // cast makes distances come out in metres on the real Earth.
  // ST_DWithin answers "within N metres?" and can use a spatial index;
  // ST_Distance gives the number we store.
  const { rows: geo } = await client.query<{ distance_m: number; inside: boolean }>(
    `WITH here AS (SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography AS point)
     SELECT ST_Distance(c.location, here.point) AS distance_m,
            ST_DWithin(c.location, here.point, c.radius_m + LEAST($4::real, $5::real)) AS inside
     FROM api.class_sessions c, here
     WHERE c.id = $1`,
    [classSessionId, lng, lat, accuracy, MAX_ACCURACY_BONUS_M],
  );
  const distanceM = geo[0]!.distance_m;
  if (!geo[0]!.inside) return { outcome: 'out_of_range', distanceM };

  // Step 4: record attendance. The primary key (class_session_id,
  // student_id) allows one row per student per window. If two requests
  // arrive at the same moment, Postgres makes the second wait for the first,
  // then ON CONFLICT DO NOTHING turns it into "no row inserted" instead of an
  // error (old bug 4: two rows). RLS (attendance_check_in) checks once more
  // that it is this student, by QR, in an open window they're enrolled in.
  const { rowCount } = await client.query(
    `INSERT INTO api.attendance (class_session_id, student_id, status, method, distance_m, gps_accuracy_m)
     VALUES ($1, $2, 'present', 'qr', $3, $4)
     ON CONFLICT (class_session_id, student_id) DO NOTHING`,
    [classSessionId, userId, distanceM, accuracy],
  );
  return { outcome: rowCount === 1 ? 'ok' : 'already_present', distanceM };
}
