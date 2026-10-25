// Audit log tests (task P5), against a real database built by globalSetup.ts.
// `admin` is the superuser (sets things up, can SET ROLE auditor); `app` is
// mahub_test_app, a member of app_rw exactly like the API, so RLS and grants apply.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const testDb = inject('testDb');

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const INSTRUCTOR_1 = '00000000-0000-0000-0000-0000000000b1'; // teaches section e1
const SECTION_E1 = '00000000-0000-0000-0000-0000000000e1';
const ROOM_F1 = '00000000-0000-0000-0000-0000000000f1';

describe.skipIf(!testDb)('audit log', () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let victim: string; // a fresh user to hand roles to

  // Runs `fn` in a transaction on the given pool, optionally as a user, then rolls back.
  async function inTx<T>(pool: pg.Pool, userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
  const asApp = <T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>) => inTx(app, userId, fn);
  const asAdmin = <T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>) => inTx(admin, userId, fn);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: testDb!.adminUrl });
    app = new pg.Pool({ connectionString: testDb!.appUrl });
    victim = (
      await admin.query(`INSERT INTO api.users (email, full_name) VALUES ('p5-victim@example.test', 'P5 Victim') RETURNING id`)
    ).rows[0].id;
  });

  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('granting a role writes one event: before is null, after holds the new row, actor is the admin', async () => {
    await asAdmin(ADMIN, async (c) => {
      await c.query(`INSERT INTO api.user_roles (user_id, role, granted_by) VALUES ($1, 'instructor', $2)`, [victim, ADMIN]);
      const { rows } = await c.query(`SELECT * FROM audit.events WHERE table_name = 'user_roles' AND row_pk->>'user_id' = $1`, [victim]);
      expect(rows).toHaveLength(1);
      expect(rows[0].op).toBe('INSERT');
      expect(rows[0].actor).toBe(ADMIN);
      expect(rows[0].before).toBeNull();
      expect(rows[0].after).toMatchObject({ user_id: victim, role: 'instructor', granted_by: ADMIN });
      expect(rows[0].row_pk).toEqual({ user_id: victim, role: 'instructor' });
    });
  });

  it('writes made through the app user are logged with that user as actor; an update keeps before and after', async () => {
    // Everything happens in one transaction that rolls back, so other test files never see these rows.
    const rows = await asAdmin(INSTRUCTOR_1, async (c) => {
      // A closed window, because only one may be open per section and other test files open one.
      const session = (
        await c.query(
          `INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
           SELECT $1, id, location, radius_m, $2, now() - interval '2 days', now() - interval '1 day'
           FROM api.rooms WHERE id = $3 RETURNING id`,
          [SECTION_E1, INSTRUCTOR_1, ROOM_F1],
        )
      ).rows[0].id;
      const student = (await c.query(`SELECT user_id FROM api.students WHERE student_no = '6722780002'`)).rows[0].user_id;

      // Write as the app user (RLS on), then switch back to the superuser to read the log.
      await c.query('SET LOCAL ROLE mahub_test_app');
      await c.query(
        `INSERT INTO api.attendance (class_session_id, student_id, status, method, recorded_by)
         VALUES ($1, $2, 'excused', 'manual', $3)`,
        [session, student, INSTRUCTOR_1],
      );
      await c.query(`UPDATE api.attendance SET status = 'present' WHERE class_session_id = $1 AND student_id = $2`, [session, student]);
      await c.query('RESET ROLE');
      return (
        await c.query(`SELECT * FROM audit.events WHERE table_name = 'attendance' AND row_pk->>'class_session_id' = $1 ORDER BY id`, [session])
      ).rows;
    });
    expect(rows.map((r) => r.op)).toEqual(['INSERT', 'UPDATE']);
    expect(rows.every((r) => r.actor === INSTRUCTOR_1)).toBe(true);
    expect(rows[1].before.status).toBe('excused');
    expect(rows[1].after.status).toBe('present');
  });

  it('enrollment changes are logged too', async () => {
    await asAdmin(null, async (c) => {
      await c.query(
        `DELETE FROM api.enrollments WHERE section_id = $1 AND student_id = (SELECT user_id FROM api.students WHERE student_no = '6722780003')`,
        [SECTION_E1],
      );
      const { rows } = await c.query(`SELECT * FROM audit.events WHERE table_name = 'enrollments' AND op = 'DELETE'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].before).toMatchObject({ section_id: SECTION_E1 });
      expect(rows[0].after).toBeNull();
    });
  });

  it('as app_rw, DELETE FROM audit.events fails', async () => {
    await expect(asApp(ADMIN, (c) => c.query('DELETE FROM audit.events'))).rejects.toThrow(/permission denied/);
  });

  it('as app_rw, UPDATE and TRUNCATE on audit.events fail', async () => {
    await expect(asApp(ADMIN, (c) => c.query('UPDATE audit.events SET actor = NULL'))).rejects.toThrow(/permission denied/);
    await expect(asApp(ADMIN, (c) => c.query('TRUNCATE audit.events'))).rejects.toThrow(/permission denied/);
  });

  it('as app_rw, SELECT from audit.events fails (only the auditor can read it)', async () => {
    await expect(asApp(ADMIN, (c) => c.query('SELECT * FROM audit.events'))).rejects.toThrow(/permission denied/);
  });

  it('app_rw cannot insert fake log rows or call the trigger function', async () => {
    await expect(
      asApp(ADMIN, (c) => c.query(`INSERT INTO audit.events (table_name, op, row_pk) VALUES ('x', 'INSERT', '{}')`)),
    ).rejects.toThrow(/permission denied/);
    await expect(asApp(ADMIN, (c) => c.query('SELECT audit.log_change()'))).rejects.toThrow(/permission denied/);
  });

  it('the auditor can read the log but still cannot change it', async () => {
    await asAdmin(null, async (c) => {
      await c.query('SET LOCAL ROLE auditor');
      const { rows } = await c.query('SELECT count(*)::int AS n FROM audit.events');
      expect(rows[0].n).toBeGreaterThan(0);
      await expect(c.query('DELETE FROM audit.events')).rejects.toThrow(/permission denied/);
    });
  });

  it('log_change is SECURITY DEFINER, owned by a NOLOGIN role, with a pinned search_path', async () => {
    const { rows } = await admin.query(
      `SELECT p.prosecdef, p.proconfig, r.rolcanlogin
       FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.oid = 'audit.log_change'::regproc`,
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].rolcanlogin).toBe(false);
    expect(rows[0].proconfig).toContain('search_path=pg_catalog, private');
  });
});
