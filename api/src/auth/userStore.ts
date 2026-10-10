import type pg from 'pg';
import type { Profile, StoredUser, UserStore } from './loginPolicy.js';

// The real UserStore, backed by the api.users / api.students / api.user_roles
// tables from PROJECT_PLAN.md §4.1 (built in task P2).
//
// Every value goes in as a $1, $2... parameter, never glued into the SQL
// string, so a strange email or name can't change the query (SQL injection).
//
// TODO(Y2): once RLS is on, these queries run before we know who the user is,
// so they will need a SECURITY DEFINER login function in `private`.
export function createUserStore(pool: Pick<pg.Pool, 'query' | 'connect'>): UserStore {
  const selectUser = 'SELECT id, email, google_sub AS "googleSub" FROM api.users';

  return {
    async findByGoogleSub(sub) {
      const { rows } = await pool.query<StoredUser>(`${selectUser} WHERE google_sub = $1`, [sub]);
      return rows[0] ?? null;
    },

    async findByEmail(email) {
      // email is citext, so this comparison ignores upper/lower case.
      const { rows } = await pool.query<StoredUser>(`${selectUser} WHERE email = $1`, [email]);
      return rows[0] ?? null;
    },

    async linkGoogleSub(userId, sub) {
      // "AND google_sub IS NULL": never overwrite a sub that is already set.
      await pool.query('UPDATE api.users SET google_sub = $2 WHERE id = $1 AND google_sub IS NULL', [userId, sub]);
    },

    async upsertStudent({ email, sub, fullName, studentNo }) {
      // Three inserts that must all happen or none: a transaction. We borrow
      // one connection from the pool because BEGIN and COMMIT must run on the
      // same connection as the statements between them.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // The CSV import may already have created this user (without a sub).
        // ON CONFLICT turns "insert" into "insert, or update the existing row".
        // COALESCE keeps an existing sub, so we can detect a mismatch below.
        const { rows } = await client.query<StoredUser>(
          `INSERT INTO api.users (email, google_sub, full_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE
             SET google_sub = COALESCE(api.users.google_sub, EXCLUDED.google_sub)
           RETURNING id, email, google_sub AS "googleSub"`,
          [email, sub, fullName],
        );
        const user = rows[0];
        if (!user || user.googleSub !== sub) {
          // This email is already linked to a different Google account. Refuse.
          await client.query('ROLLBACK');
          return null;
        }

        await client.query(
          'INSERT INTO api.students (user_id, student_no) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
          [user.id, studentNo],
        );
        // granted_by is NULL: the login policy granted it, not an admin.
        await client.query(
          `INSERT INTO api.user_roles (user_id, role) VALUES ($1, 'student') ON CONFLICT DO NOTHING`,
          [user.id],
        );

        await client.query('COMMIT');
        return user;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release(); // give the connection back to the pool
      }
    },

    async getProfile(userId) {
      // array_agg collects all the user's roles into one array, e.g. {student}.
      // FILTER drops the NULL that the LEFT JOIN gives a user with no roles.
      const { rows } = await pool.query<Profile>(
        `SELECT u.id, u.email, u.full_name AS "fullName",
                COALESCE(array_agg(r.role::text ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
         FROM api.users u
         LEFT JOIN api.user_roles r ON r.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [userId],
      );
      return rows[0] ?? null;
    },
  };
}
