import type pg from 'pg';
import { withUser } from '../db.js';

// A check-in window (a row of api.class_sessions). The room's coordinates are
// stored in the row too, but we never send them to the browser.
export interface ClassSession {
  id: string;
  section_id: string;
  room_id: string;
  radius_m: number;
  opened_by: string;
  opened_at: Date;
  closed_at: Date | null;
}

export interface MySection {
  id: string;
  course_code: string;
  course_name: string;
  term: string;
  section_no: number;
  enrolled: number;
  open_session_id: string | null;
}

// A room, as the room picker needs it. Never the coordinates or the radius:
// the location is what the check-in is judged against, and the browser has no
// use for it.
export interface Room {
  id: string;
  name: string;
}

// Why something was refused. routes.ts turns each one into an HTTP status.
export type SectionsError = 'FORBIDDEN' | 'ROOM_NOT_FOUND' | 'SESSION_ALREADY_OPEN' | 'SESSION_CLOSED';
export type Result = { ok: true; session: ClassSession } | { ok: false; error: SectionsError };

// What the endpoints need from the database. Tests use a fake one.
export interface SectionsStore {
  listMine(userId: string): Promise<MySection[]>;
  listRooms(userId: string): Promise<Room[]>;
  open(userId: string, sectionId: string, roomId: string): Promise<Result>;
  close(userId: string, classSessionId: string): Promise<Result>;
  get(userId: string, classSessionId: string): Promise<Result>;
}

// Never SELECT * here: `location` is a geography column and the browser
// doesn't need it.
const COLUMNS = 'id, section_id, room_id, radius_m, opened_by, opened_at, closed_at';

// "Role AND ownership": being an instructor isn't enough, you must teach THIS
// section. Row-level security already enforces both, but we check them in the
// query too, so a refusal is a clean "nothing matched" and not a database error.
// `section` is the SQL expression for the section id (a column or a parameter).
const mayManage = (section: string) => `private.has_role('instructor') AND private.teaches_section(${section})`;

export function createSectionsStore(pool: Pick<pg.Pool, 'query' | 'connect'>): SectionsStore {
  return {
    async listMine(userId) {
      return withUser(pool, userId, async (client) => {
        const { rows } = await client.query<MySection>(
          `SELECT s.id, c.code AS course_code, c.name AS course_name, s.term, s.section_no,
                  (SELECT count(*)::int FROM api.enrollments e WHERE e.section_id = s.id) AS enrolled,
                  (SELECT cs.id FROM api.class_sessions cs
                    WHERE cs.section_id = s.id AND cs.closed_at IS NULL) AS open_session_id
           FROM api.sections s
           JOIN api.courses c ON c.id = s.course_id
           WHERE ${mayManage('s.id')} AND s.archived_at IS NULL
           ORDER BY c.code, s.term DESC, s.section_no`,
        );
        return rows;
      });
    },

    async listRooms(userId) {
      return withUser(pool, userId, async (client) => {
        // Row-level security lets any signed-in user read rooms (and nobody
        // else). We ask for id and name only: `location` stays in the database.
        const { rows } = await client.query<Room>('SELECT id, name FROM api.rooms ORDER BY name');
        return rows;
      });
    },

    async open(userId, sectionId, roomId) {
      try {
        return await withUser(pool, userId, async (client): Promise<Result> => {
          // Copy the room's location and radius into the new row (the
          // "snapshot"), so editing the room later doesn't rewrite history.
          // INSERT ... SELECT inserts zero rows when the section isn't theirs
          // or the room doesn't exist.
          const { rows } = await client.query<ClassSession>(
            `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by)
             SELECT s.id, r.id, r.location, r.radius_m, private.current_user_id()
             FROM api.sections s CROSS JOIN api.rooms r
             WHERE s.id = $1 AND r.id = $2 AND ${mayManage('s.id')}
             RETURNING ${COLUMNS}`,
            [sectionId, roomId],
          );
          if (rows[0]) return { ok: true, session: rows[0] };

          // Nothing was inserted. Was it the section or the room?
          const { rows: mine } = await client.query<{ ok: boolean }>(`SELECT (${mayManage('$1::uuid')}) AS ok`, [
            sectionId,
          ]);
          return { ok: false, error: mine[0]?.ok ? 'ROOM_NOT_FOUND' : 'FORBIDDEN' };
        });
      } catch (err) {
        // The partial unique index from P2 (one open window per section) is
        // the real guard: two simultaneous clicks can't both get through it.
        // Postgres reports it as error 23505, which we turn into a clean answer.
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23505' && e.constraint === 'class_sessions_one_open_per_section') {
          return { ok: false, error: 'SESSION_ALREADY_OPEN' };
        }
        throw err; // anything else is a real bug: let the error handler log it
      }
    },

    async close(userId, classSessionId) {
      return withUser(pool, userId, async (client): Promise<Result> => {
        const { rows } = await client.query<ClassSession>(
          `UPDATE api.class_sessions SET closed_at = now()
           WHERE id = $1 AND closed_at IS NULL AND ${mayManage('section_id')}
           RETURNING ${COLUMNS}`,
          [classSessionId],
        );
        if (rows[0]) return { ok: true, session: rows[0] };

        // Nothing changed. Either it's not theirs (or doesn't exist), or it was already closed.
        const { rows: theirs } = await client.query(
          `SELECT 1 FROM api.class_sessions WHERE id = $1 AND ${mayManage('section_id')}`,
          [classSessionId],
        );
        return { ok: false, error: theirs[0] ? 'SESSION_CLOSED' : 'FORBIDDEN' };
      });
    },

    async get(userId, classSessionId) {
      return withUser(pool, userId, async (client): Promise<Result> => {
        const { rows } = await client.query<ClassSession>(
          `SELECT ${COLUMNS} FROM api.class_sessions WHERE id = $1 AND ${mayManage('section_id')}`,
          [classSessionId],
        );
        return rows[0] ? { ok: true, session: rows[0] } : { ok: false, error: 'FORBIDDEN' };
      });
    },
  };
}
