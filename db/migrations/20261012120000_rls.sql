-- migrate:up
-- Task Y2: grants and row-level security (RLS) on every api table (PROJECT_PLAN.md §4.3).
--
-- How it fits together:
--   * The API logs in as a user that is a member of app_rw (never a superuser:
--     superusers skip RLS entirely).
--   * At the start of each transaction the API runs
--       SELECT set_config('app.user_id', '<uuid>', true)   -- same as SET LOCAL
--     and every policy below reads it through private.current_user_id().
--   * No user id set = no rows. Safe by default.
-- docs/PERMISSIONS.md has the same rules as a table.

-- ============================================================ helper owner
-- The SECURITY DEFINER helpers below run as this role instead of the caller.
-- NOLOGIN: nobody can sign in as it. BYPASSRLS: the helpers must read
-- user_roles, sections... without being filtered by the very policies that
-- call them (that would loop forever). That's why each helper is small, only
-- answers yes/no or does one fixed job, and the role gets only the table
-- rights listed below.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_definer') THEN
        CREATE ROLE rls_definer NOLOGIN BYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA api, private TO rls_definer;
GRANT SELECT ON api.users, api.user_roles, api.students, api.sections,
                api.enrollments, api.class_sessions TO rls_definer;
-- For the login functions (first sign-in creates the student).
GRANT INSERT ON api.users, api.students, api.user_roles TO rls_definer;
GRANT UPDATE (google_sub) ON api.users TO rls_definer;

-- ======================================================== "who is asking?"
-- Reads the id the API set for this transaction. After the transaction ends
-- the setting becomes '' (not NULL), so nullif turns that back into NULL.
CREATE FUNCTION private.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path = pg_catalog
AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ============================================================ yes/no checks
-- SECURITY DEFINER = runs with rls_definer's rights, not the caller's.
-- SET search_path = pg_catalog, private: a caller can't trick the function
-- into using their own look-alike tables or functions. Every table name is
-- written in full (api.user_roles) for the same reason.

-- Does the current user have this role?
CREATE FUNCTION private.has_role(r api.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT EXISTS (
        SELECT 1 FROM api.user_roles
        WHERE user_id = private.current_user_id() AND role = r)
$$;

-- Is the current user the instructor of this section?
CREATE FUNCTION private.teaches_section(p_section_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT EXISTS (
        SELECT 1 FROM api.sections
        WHERE id = p_section_id AND instructor_id = private.current_user_id())
$$;

-- Is the current user the instructor of this check-in window's section?
CREATE FUNCTION private.teaches_class_session(p_class_session_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT EXISTS (
        SELECT 1 FROM api.class_sessions c
        JOIN api.sections s ON s.id = c.section_id
        WHERE c.id = p_class_session_id AND s.instructor_id = private.current_user_id())
$$;

-- Is this student enrolled in a section the current user teaches?
-- (So an instructor can see the names on their own roster.)
CREATE FUNCTION private.teaches_student(p_student_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT EXISTS (
        SELECT 1 FROM api.enrollments e
        JOIN api.sections s ON s.id = e.section_id
        WHERE e.student_id = p_student_id AND s.instructor_id = private.current_user_id())
$$;

-- Is the current user enrolled in this section?
CREATE FUNCTION private.is_enrolled(p_section_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT EXISTS (
        SELECT 1 FROM api.enrollments
        WHERE section_id = p_section_id AND student_id = private.current_user_id())
$$;

-- May the current user check in to this window right now?
-- (Enrolled in its section, and the window is still open.) The check-in code
-- (Y4) checks this too; the policy is a second lock if that code has a bug.
CREATE FUNCTION private.can_check_in(p_class_session_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT EXISTS (
        SELECT 1 FROM api.class_sessions c
        JOIN api.enrollments e ON e.section_id = c.section_id
        WHERE c.id = p_class_session_id AND c.closed_at IS NULL
          AND e.student_id = private.current_user_id())
$$;

-- ========================================================= login functions
-- Sign-in (Y1) happens before we know who the user is, so RLS would show
-- the API nothing. These functions do exactly the lookups the login policy
-- (ADR 0007) needs and nothing more. Emails are compared with lower() because
-- citext's case-insensitive "=" lives in the public schema, which is not on
-- this search_path.

CREATE FUNCTION private.login_user_by_sub(p_sub text) RETURNS SETOF api.users
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT * FROM api.users WHERE google_sub = p_sub
$$;

CREATE FUNCTION private.login_user_by_email(p_email text) RETURNS SETOF api.users
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT * FROM api.users WHERE lower(email::text) = lower(p_email)
$$;

-- First login of a user an admin registered: remember their Google sub.
-- Never overwrites a sub that is already set.
CREATE FUNCTION private.login_link_google_sub(p_user_id uuid, p_sub text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    UPDATE api.users SET google_sub = p_sub WHERE id = p_user_id AND google_sub IS NULL
$$;

-- First login of a SIIT student: make sure the users row, the students row
-- and the 'student' role exist (a CSV import may have made some already).
-- Returns the user; if its google_sub differs from p_sub, the email belongs to
-- another Google account and nothing else is changed (the API then refuses).
CREATE FUNCTION private.login_upsert_student(
    p_email text, p_sub text, p_full_name text, p_student_no text
) RETURNS api.users
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
DECLARE
    u api.users;
BEGIN
    -- Defence in depth: even a buggy or compromised API can only create
    -- students with real SIIT student emails, never anything else.
    IF lower(p_email) !~ '^[0-9]{10}@g\.siit\.tu\.ac\.th$'
       OR split_part(lower(p_email), '@', 1) <> p_student_no THEN
        RAISE EXCEPTION 'not a SIIT student email' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO api.users (email, google_sub, full_name)
    VALUES (lower(p_email), p_sub, p_full_name)
    ON CONFLICT (email) DO UPDATE
        SET google_sub = COALESCE(api.users.google_sub, EXCLUDED.google_sub)
    RETURNING * INTO u;

    IF u.google_sub IS DISTINCT FROM p_sub THEN
        RETURN u;  -- linked to a different Google account: change nothing more
    END IF;

    INSERT INTO api.students (user_id, student_no) VALUES (u.id, p_student_no)
    ON CONFLICT (user_id) DO NOTHING;
    -- granted_by NULL: the login policy granted it, not an admin.
    INSERT INTO api.user_roles (user_id, role) VALUES (u.id, 'student')
    ON CONFLICT DO NOTHING;
    RETURN u;
END
$$;

-- Owned by the NOLOGIN role (CLAUDE.md). current_user_id() is not SECURITY
-- DEFINER, so it can stay with the migration's owner.
ALTER FUNCTION private.has_role(api.app_role) OWNER TO rls_definer;
ALTER FUNCTION private.teaches_section(uuid) OWNER TO rls_definer;
ALTER FUNCTION private.teaches_class_session(uuid) OWNER TO rls_definer;
ALTER FUNCTION private.teaches_student(uuid) OWNER TO rls_definer;
ALTER FUNCTION private.is_enrolled(uuid) OWNER TO rls_definer;
ALTER FUNCTION private.can_check_in(uuid) OWNER TO rls_definer;
ALTER FUNCTION private.login_user_by_sub(text) OWNER TO rls_definer;
ALTER FUNCTION private.login_user_by_email(text) OWNER TO rls_definer;
ALTER FUNCTION private.login_link_google_sub(uuid, text) OWNER TO rls_definer;
ALTER FUNCTION private.login_upsert_student(text, text, text, text) OWNER TO rls_definer;

-- ================================================================== grants
-- Postgres lets EVERYONE run a new function by default. Take that away first.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;

-- app_rw: the API. Read, add and change data; never DELETE, never change
-- tables, never skip RLS. app_ro: read-only reports. Both stay under RLS.
GRANT USAGE ON SCHEMA api, private TO app_rw, app_ro;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA api TO app_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO app_ro;
-- Policies call these as the person asking, so they need EXECUTE.
GRANT EXECUTE ON FUNCTION
    private.current_user_id(), private.has_role(api.app_role),
    private.teaches_section(uuid), private.teaches_class_session(uuid),
    private.teaches_student(uuid), private.is_enrolled(uuid), private.can_check_in(uuid)
TO app_rw, app_ro;
-- The yes/no helpers run as rls_definer and ask "who is asking?" too.
GRANT EXECUTE ON FUNCTION private.current_user_id() TO rls_definer;
-- Only the API signs people in.
GRANT EXECUTE ON FUNCTION
    private.login_user_by_sub(text), private.login_user_by_email(text),
    private.login_link_google_sub(uuid, text), private.login_upsert_student(text, text, text, text)
TO app_rw;

-- auditor reads the audit log and nothing else. Nobody gets UPDATE or DELETE on it.
GRANT USAGE ON SCHEMA audit TO auditor;
GRANT SELECT ON audit.events TO auditor;

-- ======================================================= row-level security
-- A table with RLS on and no matching policy shows nothing and accepts nothing.
-- Policies for the same action are OR-ed: one match is enough.
-- "admin_all" = admins may read and write everything in that table.
ALTER TABLE api.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.courses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.sections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.rooms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.enrollments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.class_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.attendance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.checkin_attempts ENABLE ROW LEVEL SECURITY;

-- users: yourself; instructors see their own students; admins see everyone.
CREATE POLICY users_admin_all ON api.users FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY users_select ON api.users FOR SELECT
    USING (id = private.current_user_id() OR private.teaches_student(id));

-- user_roles: you see your own roles. ONLY admins write (old bug 1:
-- a student made themselves admin).
CREATE POLICY user_roles_admin_all ON api.user_roles FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY user_roles_select_own ON api.user_roles FOR SELECT
    USING (user_id = private.current_user_id());

-- students: yourself, and your instructors.
CREATE POLICY students_admin_all ON api.students FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY students_select ON api.students FOR SELECT
    USING (user_id = private.current_user_id() OR private.teaches_student(user_id));

-- courses and rooms: anyone signed in may read; admins write.
CREATE POLICY courses_admin_all ON api.courses FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY courses_select ON api.courses FOR SELECT
    USING (private.current_user_id() IS NOT NULL);

CREATE POLICY rooms_admin_all ON api.rooms FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY rooms_select ON api.rooms FOR SELECT
    USING (private.current_user_id() IS NOT NULL);

-- sections: the instructor and enrolled students see it. Only admins create
-- sections (old bug 3: any student could create a class).
CREATE POLICY sections_admin_all ON api.sections FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY sections_select ON api.sections FOR SELECT
    USING (instructor_id = private.current_user_id() OR private.is_enrolled(id));

-- enrollments: your own, or your section's.
CREATE POLICY enrollments_admin_all ON api.enrollments FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY enrollments_select ON api.enrollments FOR SELECT
    USING (student_id = private.current_user_id() OR private.teaches_section(section_id));

-- class_sessions (check-in windows): the section's instructor opens and
-- closes them (P3); enrolled students may see them.
CREATE POLICY class_sessions_admin_all ON api.class_sessions FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY class_sessions_select ON api.class_sessions FOR SELECT
    USING (private.teaches_section(section_id) OR private.is_enrolled(section_id));
CREATE POLICY class_sessions_open ON api.class_sessions FOR INSERT
    WITH CHECK (private.teaches_section(section_id) AND opened_by = private.current_user_id());
CREATE POLICY class_sessions_close ON api.class_sessions FOR UPDATE
    USING (private.teaches_section(section_id))
    WITH CHECK (private.teaches_section(section_id));

-- attendance: students see their own; the instructor sees their section's.
CREATE POLICY attendance_admin_all ON api.attendance FOR ALL
    USING (private.has_role('admin')) WITH CHECK (private.has_role('admin'));
CREATE POLICY attendance_select ON api.attendance FOR SELECT
    USING (student_id = private.current_user_id() OR private.teaches_class_session(class_session_id));
-- A student can only record THEMSELVES as present by QR, in an open window of
-- a section they're enrolled in (Y4 runs this inside its transaction).
CREATE POLICY attendance_check_in ON api.attendance FOR INSERT
    WITH CHECK (student_id = private.current_user_id()
                AND method = 'qr' AND status = 'present' AND recorded_by IS NULL
                AND private.can_check_in(class_session_id));
-- The instructor marks students by hand (P4), and must sign the mark.
CREATE POLICY attendance_manual_mark ON api.attendance FOR INSERT
    WITH CHECK (private.teaches_class_session(class_session_id)
                AND method = 'manual' AND recorded_by = private.current_user_id());
CREATE POLICY attendance_manual_change ON api.attendance FOR UPDATE
    USING (private.teaches_class_session(class_session_id))
    WITH CHECK (private.teaches_class_session(class_session_id)
                AND method = 'manual' AND recorded_by = private.current_user_id());

-- checkin_attempts: a log. You add your own; nobody changes it afterwards.
CREATE POLICY checkin_attempts_select ON api.checkin_attempts FOR SELECT
    USING (user_id = private.current_user_id()
           OR private.teaches_class_session(class_session_id)
           OR private.has_role('admin'));
CREATE POLICY checkin_attempts_insert_own ON api.checkin_attempts FOR INSERT
    WITH CHECK (user_id = private.current_user_id());

-- migrate:down
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'api' LOOP
        EXECUTE format('DROP POLICY %I ON api.%I', p.policyname, p.tablename);
    END LOOP;
END
$$;

ALTER TABLE api.users            DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.user_roles       DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.students         DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.courses          DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.sections         DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.rooms            DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.enrollments      DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.class_sessions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.attendance       DISABLE ROW LEVEL SECURITY;
ALTER TABLE api.checkin_attempts DISABLE ROW LEVEL SECURITY;

REVOKE SELECT ON audit.events FROM auditor;
REVOKE USAGE ON SCHEMA audit FROM auditor;
REVOKE ALL ON ALL TABLES IN SCHEMA api FROM app_rw, app_ro, rls_definer;
REVOKE USAGE ON SCHEMA api, private FROM app_rw, app_ro, rls_definer;

DROP FUNCTION private.login_upsert_student(text, text, text, text);
DROP FUNCTION private.login_link_google_sub(uuid, text);
DROP FUNCTION private.login_user_by_email(text);
DROP FUNCTION private.login_user_by_sub(text);
DROP FUNCTION private.can_check_in(uuid);
DROP FUNCTION private.is_enrolled(uuid);
DROP FUNCTION private.teaches_student(uuid);
DROP FUNCTION private.teaches_class_session(uuid);
DROP FUNCTION private.teaches_section(uuid);
DROP FUNCTION private.has_role(api.app_role);
DROP FUNCTION private.current_user_id();

-- rls_definer is NOT dropped: roles are shared by every database on the
-- server, and another database (e.g. the test database) may still use it.
