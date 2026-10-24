import type pg from 'pg';
import { withUser } from '../db.js';

// What the QR endpoints need from the database. Tests use a fake one.
export interface QrStore {
  // For the projector: the window's state if this user teaches its section,
  // or null (not found, or not theirs: we don't say which).
  windowStateForInstructor(userId: string, classSessionId: string): Promise<'open' | 'closed' | null>;
  // For a scan: is the window open? Works before the student has signed in.
  isOpen(classSessionId: string): Promise<boolean>;
}

export function createQrStore(pool: Pick<pg.Pool, 'query' | 'connect'>): QrStore {
  return {
    async windowStateForInstructor(userId, classSessionId) {
      return withUser(pool, userId, async (client) => {
        // RLS lets enrolled students see a window too, so also require that
        // this user teaches it: only the instructor gets the projector QR.
        const { rows } = await client.query<{ open: boolean }>(
          `SELECT closed_at IS NULL AS open FROM api.class_sessions
           WHERE id = $1 AND private.teaches_section(section_id)`,
          [classSessionId],
        );
        const row = rows[0];
        return row ? (row.open ? 'open' : 'closed') : null;
      });
    },

    async isOpen(classSessionId) {
      const { rows } = await pool.query<{ open: boolean }>('SELECT private.class_session_is_open($1) AS open', [
        classSessionId,
      ]);
      return rows[0]?.open ?? false;
    },
  };
}
