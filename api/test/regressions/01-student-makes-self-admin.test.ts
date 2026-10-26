// Old bug 1: a student set their own `users.role` to 'admin'.
// Fix: there is no role column on users. Roles live in user_roles, and only
// an admin may write it (RLS, db/migrations/*_rls.sql). More role tests are
// in test/db/rls.test.ts.
import { afterAll, describe, expect, inject, it } from 'vitest';
import { pools, rolledBack, studentId } from './helpers.js';

const testDb = inject('testDb');

describe.skipIf(!testDb)('old bug 1: a student makes themselves admin', () => {
  const { admin, app } = testDb ? pools(testDb) : ({} as ReturnType<typeof pools>);
  afterAll(async () => {
    await admin?.end();
    await app?.end();
  });

  it('users has no role column to change', async () => {
    const { rows } = await admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'api' AND table_name = 'users'`,
    );
    expect(rows.map((r) => r.column_name)).not.toContain('role');
  });

  it('a student cannot give themselves the admin role', async () => {
    const me = await studentId(admin, '6722780025');
    await expect(
      rolledBack(app, me, (c) => c.query(`INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'admin')`, [me])),
    ).rejects.toThrow(/row-level security/);
  });

  it('a student cannot turn their student role into admin', async () => {
    const me = await studentId(admin, '6722780025');
    const changed = await rolledBack(app, me, (c) =>
      c.query(`UPDATE api.user_roles SET role = 'admin' WHERE user_id = $1`, [me]),
    );
    expect(changed.rowCount).toBe(0); // RLS: no row is theirs to update
  });
});
