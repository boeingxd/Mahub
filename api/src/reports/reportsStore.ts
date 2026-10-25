import type pg from 'pg';
import { withUser } from '../db.js';
import { mayManage } from '../sections/sectionsStore.js';

export interface RosterRow {
  student_id: string;
  student_no: string;
  full_name: string;
  status: 'present' | 'excused' | 'absent';
  method: 'qr' | 'manual' | null; // null when absent
  recorded_at: Date | null;
}

export interface Roster {
  counts: { enrolled: number; present: number; excused: number; absent: number };
  students: RosterRow[];
}

export interface RateRow {
  student_id: string;
  student_no: string;
  full_name: string;
  sessions_held: number;
  attended: number;
  excused: number;
  rate_pct: number | null; // null = nothing to divide by yet
}

export interface MarkedAttendance {
  class_session_id: string;
  student_id: string;
  status: 'present' | 'excused';
  method: 'manual';
  recorded_at: Date;
  recorded_by: string;
}

export type ReportsError = 'FORBIDDEN' | 'NOT_ENROLLED';
type Result<K extends string, T> = ({ ok: true } & { [P in K]: T }) | { ok: false; error: ReportsError };

// What the endpoints need from the database. Tests use a fake one.
export interface ReportsStore {
  roster(userId: string, classSessionId: string): Promise<Result<'roster', Roster>>;
  report(userId: string, sectionId: string): Promise<Result<'rows', RateRow[]>>;
  mark(
    userId: string,
    classSessionId: string,
    studentId: string,
    status: 'present' | 'excused',
  ): Promise<Result<'attendance', MarkedAttendance>>;
}

export function createReportsStore(pool: Pick<pg.Pool, 'query' | 'connect'>): ReportsStore {
  return {
    async roster(userId, classSessionId) {
      return withUser(pool, userId, async (client) => {
        // The views already follow row-level security, but an empty answer
        // would look the same for "not your class" and "nobody enrolled", so
        // check ownership first and answer 403 for the former.
        const { rows: own } = await client.query(
          `SELECT 1 FROM api.class_sessions WHERE id = $1 AND ${mayManage('section_id')}`,
          [classSessionId],
        );
        if (!own[0]) return { ok: false, error: 'FORBIDDEN' };

        const { rows: students } = await client.query<RosterRow>(
          `SELECT student_id, student_no, full_name, status, method, recorded_at
           FROM api.v_session_roster WHERE class_session_id = $1 ORDER BY student_no`,
          [classSessionId],
        );
        // The counts are worked out by the database too, never in the browser.
        const { rows } = await client.query<Roster['counts']>(
          `SELECT count(*)::int                                  AS enrolled,
                  (count(*) FILTER (WHERE status = 'present'))::int AS present,
                  (count(*) FILTER (WHERE status = 'excused'))::int AS excused,
                  (count(*) FILTER (WHERE status = 'absent'))::int  AS absent
           FROM api.v_session_roster WHERE class_session_id = $1`,
          [classSessionId],
        );
        return { ok: true, roster: { counts: rows[0]!, students } };
      });
    },

    async report(userId, sectionId) {
      return withUser(pool, userId, async (client) => {
        const { rows: own } = await client.query(`SELECT 1 FROM api.sections WHERE id = $1 AND ${mayManage('id')}`, [
          sectionId,
        ]);
        if (!own[0]) return { ok: false, error: 'FORBIDDEN' };

        const { rows } = await client.query<RateRow>(
          `SELECT student_id, student_no, full_name, sessions_held, attended, excused, rate_pct
           FROM api.v_section_attendance_rate WHERE section_id = $1 ORDER BY student_no`,
          [sectionId],
        );
        return { ok: true, rows };
      });
    },

    async mark(userId, classSessionId, studentId, status) {
      return withUser(pool, userId, async (client) => {
        // "Insert, or if the student already has a row for this window, replace
        // it" (ON CONFLICT ... DO UPDATE). The mark is signed with the
        // instructor's own id (never one sent by the browser), and a manual
        // mark has no GPS distance, so the old one (from a QR check-in) is dropped.
        // INSERT ... SELECT inserts nothing unless the window is theirs AND
        // the student is enrolled in its section.
        const { rows } = await client.query<MarkedAttendance>(
          `INSERT INTO api.attendance (class_session_id, student_id, status, method, recorded_by)
           SELECT cs.id, $2::uuid, $3::api.attendance_status, 'manual', private.current_user_id()
           FROM api.class_sessions cs
           WHERE cs.id = $1 AND ${mayManage('cs.section_id')}
             AND EXISTS (SELECT 1 FROM api.enrollments e WHERE e.section_id = cs.section_id AND e.student_id = $2::uuid)
           ON CONFLICT (class_session_id, student_id) DO UPDATE
             SET status = EXCLUDED.status, method = 'manual', recorded_by = EXCLUDED.recorded_by,
                 recorded_at = now(), distance_m = NULL, gps_accuracy_m = NULL
           RETURNING class_session_id, student_id, status, method, recorded_at, recorded_by`,
          [classSessionId, studentId, status],
        );
        if (rows[0]) return { ok: true, attendance: rows[0] };

        // Nothing was written. Not their window, or the student isn't in the section?
        const { rows: own } = await client.query(
          `SELECT 1 FROM api.class_sessions WHERE id = $1 AND ${mayManage('section_id')}`,
          [classSessionId],
        );
        return { ok: false, error: own[0] ? 'NOT_ENROLLED' : 'FORBIDDEN' };
      });
    },
  };
}
