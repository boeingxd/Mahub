import type pg from 'pg';
import { withUser } from '../db.js';
import type { Profile, StoredUser, UserStore } from './loginPolicy.js';

// The real UserStore, backed by the api.users / api.students / api.user_roles
// tables from PROJECT_PLAN.md §4.1 (built in task P2).
//
// Every value goes in as a $1, $2... parameter, never glued into the SQL
// string, so a strange email or name can't change the query (SQL injection).
//
// Row-level security (task Y2) hides every row until we know who is asking,
// and during sign-in we don't know yet. So the lookups below call small
// SECURITY DEFINER functions in the `private` schema that do exactly what the
// login policy needs (see db/migrations/*_rls.sql). Once we know the user,
// getProfile runs as that user, under the normal RLS rules.
export function createUserStore(pool: Pick<pg.Pool, 'query' | 'connect'>): UserStore {
  const columns = 'id, email, google_sub AS "googleSub"';

  return {
    async findByGoogleSub(sub) {
      const { rows } = await pool.query<StoredUser>(`SELECT ${columns} FROM private.login_user_by_sub($1)`, [sub]);
      return rows[0] ?? null;
    },

    async findByEmail(email) {
      const { rows } = await pool.query<StoredUser>(`SELECT ${columns} FROM private.login_user_by_email($1)`, [email]);
      return rows[0] ?? null;
    },

    async linkGoogleSub(userId, sub) {
      // The function never overwrites a sub that is already set.
      await pool.query('SELECT private.login_link_google_sub($1, $2)', [userId, sub]);
    },

    async upsertStudent({ email, sub, fullName, studentNo }) {
      // One function call = one statement, so its three inserts (users,
      // students, user_roles) happen together or not at all.
      const { rows } = await pool.query<StoredUser>(
        `SELECT ${columns} FROM private.login_upsert_student($1, $2, $3, $4)`,
        [email, sub, fullName, studentNo],
      );
      const user = rows[0];
      // A different sub means this email belongs to another Google account. Refuse.
      return user && user.googleSub === sub ? user : null;
    },

    async getProfile(userId) {
      // Runs as the user: RLS lets them read their own users row and roles.
      return withUser(pool, userId, async (client) => {
        // array_agg collects all the user's roles into one array, e.g. {student}.
        // FILTER drops the NULL that the LEFT JOIN gives a user with no roles.
        const { rows } = await client.query<Profile>(
          `SELECT u.id, u.email, u.full_name AS "fullName",
                  COALESCE(array_agg(r.role::text ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
           FROM api.users u
           LEFT JOIN api.user_roles r ON r.user_id = u.id
           WHERE u.id = $1
           GROUP BY u.id`,
          [userId],
        );
        return rows[0] ?? null;
      });
    },
  };
}
