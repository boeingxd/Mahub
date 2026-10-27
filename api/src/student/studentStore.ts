import type pg from 'pg';
import { withUser } from '../db.js';

// One class I'm in, with my numbers. The rate is worked out by the view
// api.v_my_classes, never here.
export interface ClassLine {
  section_id: string;
  course_code: string;
  course_name: string;
  term: string;
  section_no: number;
  instructor_name: string | null; // null when there is no name to show
  sessions_held: number;
  attended: number;
  excused: number;
  sessions_counted: number; // sessions_held - excused: what rate_pct divides by
  rate_pct: number | null; // null = nothing to divide by yet
}

export type OverviewClass = Omit<ClassLine, 'instructor_name' | 'term'>;

export interface Overview {
  overall: Pick<ClassLine, 'sessions_held' | 'attended' | 'excused' | 'sessions_counted' | 'rate_pct'>;
  classes: OverviewClass[];
  recent_checkins: {
    class_session_id: string;
    section_id: string;
    course_code: string;
    course_name: string;
    recorded_at: Date;
    method: 'qr' | 'manual';
  }[];
}

export interface ClassSessions {
  class: ClassLine;
  sessions: {
    class_session_id: string;
    opened_at: Date;
    is_open: boolean;
    status: 'present' | 'excused' | 'absent';
    method: 'qr' | 'manual' | null; // null when absent
    recorded_at: Date | null;
  }[];
}

export type StudentError = 'FORBIDDEN';
export type ClassSessionsResult = { ok: true; detail: ClassSessions } | { ok: false; error: StudentError };

// What the endpoints need from the database. Tests use a fake one.
export interface StudentStore {
  classes(userId: string): Promise<ClassLine[]>;
  overview(userId: string): Promise<Overview>;
  classSessions(userId: string, sectionId: string): Promise<ClassSessionsResult>;
}

const CLASS_COLUMNS = `section_id, course_code, course_name, term, section_no, instructor_name,
                       sessions_held, attended, excused, sessions_counted, rate_pct`;

export function createStudentStore(pool: Pick<pg.Pool, 'connect'>): StudentStore {
  return {
    // The views only return lines for the person the transaction was opened
    // for (they read private.current_user_id()), and RLS limits the rows
    // underneath, so there is no student id to pass in from the browser.
    async classes(userId) {
      return withUser(pool, userId, async (client) => {
        const { rows } = await client.query<ClassLine>(
          `SELECT ${CLASS_COLUMNS} FROM api.v_my_classes ORDER BY course_code, section_no`,
        );
        return rows;
      });
    },

    async overview(userId) {
      return withUser(pool, userId, async (client) => {
        const { rows: overall } = await client.query<Overview['overall']>(
          `SELECT sessions_held, attended, excused, sessions_counted, rate_pct FROM api.v_my_overview`,
        );
        const { rows: classes } = await client.query<OverviewClass>(
          `SELECT section_id, course_code, course_name, section_no,
                  sessions_held, attended, excused, sessions_counted, rate_pct
           FROM api.v_my_classes ORDER BY course_code, section_no`,
        );
        const { rows: recent } = await client.query<Overview['recent_checkins'][number]>(
          `SELECT class_session_id, section_id, course_code, course_name, recorded_at, method
           FROM api.v_my_recent_checkins ORDER BY recorded_at DESC, class_session_id LIMIT 5`,
        );
        return { overall: overall[0]!, classes, recent_checkins: recent };
      });
    },

    async classSessions(userId, sectionId) {
      return withUser(pool, userId, async (client) => {
        // Not enrolled and "no such section" look the same (an empty answer),
        // and both are a 403, so nobody can probe which ids are real.
        const { rows: cls } = await client.query<ClassLine>(
          `SELECT ${CLASS_COLUMNS} FROM api.v_my_classes WHERE section_id = $1`,
          [sectionId],
        );
        if (!cls[0]) return { ok: false, error: 'FORBIDDEN' };

        const { rows: sessions } = await client.query<ClassSessions['sessions'][number]>(
          `SELECT class_session_id, opened_at, is_open, status, method, recorded_at
           FROM api.v_session_roster
           WHERE section_id = $1 AND student_id = private.current_user_id()
           ORDER BY opened_at DESC, class_session_id`,
          [sectionId],
        );
        return { ok: true, detail: { class: cls[0], sessions } };
      });
    },
  };
}
