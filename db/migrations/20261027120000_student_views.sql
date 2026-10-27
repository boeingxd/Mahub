-- migrate:up
-- Task B6: what the three student screens read (docs/API.md, "Student endpoints").
--
-- Same idea as the P4 report views: the numbers are worked out here, once, in
-- SQL, and the API only fetches them. All the views are security_invoker, so
-- row-level security still applies: a student sees their own enrollments, the
-- windows of their own sections and their own attendance rows, nothing else.

-- ---- two existing views get extra columns at the end -----------------------

-- sessions_counted = sessions_held - excused: exactly the number the rate
-- divides by, so a screen can say "10 of 11" without doing any arithmetic.
CREATE OR REPLACE VIEW api.v_section_attendance_rate WITH (security_invoker = true) AS
SELECT e.section_id,
       st.user_id                     AS student_id,
       st.student_no,
       u.full_name,
       count(cs.id)::int                                              AS sessions_held,
       (count(a.student_id) FILTER (WHERE a.status = 'present'))::int AS attended,
       (count(a.student_id) FILTER (WHERE a.status = 'excused'))::int AS excused,
       round(
           100.0 * count(a.student_id) FILTER (WHERE a.status = 'present')
           / NULLIF(count(cs.id) - count(a.student_id) FILTER (WHERE a.status = 'excused'), 0),
           1
       )::float8                                                      AS rate_pct,
       (count(cs.id) - count(a.student_id) FILTER (WHERE a.status = 'excused'))::int AS sessions_counted
FROM api.enrollments e
JOIN api.students st ON st.user_id = e.student_id
JOIN api.users u     ON u.id = st.user_id
LEFT JOIN api.class_sessions cs ON cs.section_id = e.section_id
LEFT JOIN api.attendance a
       ON a.class_session_id = cs.id AND a.student_id = e.student_id
GROUP BY e.section_id, st.user_id, st.student_no, u.full_name;

-- opened_at and is_open let the class detail screen sort the windows and say
-- "Open now" instead of "Absent" for a window that is still running.
CREATE OR REPLACE VIEW api.v_session_roster WITH (security_invoker = true) AS
SELECT cs.id                          AS class_session_id,
       cs.section_id,
       st.user_id                     AS student_id,
       st.student_no,
       u.full_name,
       COALESCE(a.status::text, 'absent') AS status,   -- present | excused | absent
       a.method::text                 AS method,       -- qr | manual | NULL when absent
       a.recorded_at,
       cs.opened_at,
       (cs.closed_at IS NULL)         AS is_open
FROM api.class_sessions cs
JOIN api.enrollments e  ON e.section_id = cs.section_id
JOIN api.students st    ON st.user_id = e.student_id
JOIN api.users u        ON u.id = st.user_id
LEFT JOIN api.attendance a
       ON a.class_session_id = cs.id AND a.student_id = e.student_id;

-- ---- the instructor's name -------------------------------------------------
-- A student can't read the instructor's users row (the users_select policy
-- only shows you yourself and the students you teach), and we don't want to
-- loosen that policy. Instead this one small function, which runs with
-- rls_definer's rights, hands back ONLY the full name, and ONLY for a section
-- the caller is enrolled in. NULL otherwise (not enrolled, or nobody signed in).
-- SET search_path = pg_catalog, private: the caller can't swap in look-alike
-- tables or functions. Every table name is written in full for the same reason.
CREATE FUNCTION private.student_instructor_name(p_section_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT u.full_name
    FROM api.sections s
    JOIN api.users u ON u.id = s.instructor_id
    WHERE s.id = p_section_id AND private.is_enrolled(p_section_id)
$$;
ALTER FUNCTION private.student_instructor_name(uuid) OWNER TO rls_definer;
REVOKE EXECUTE ON FUNCTION private.student_instructor_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.student_instructor_name(uuid) TO app_rw, app_ro;

-- ---- My classes: one line per class I'm enrolled in ------------------------
-- "Me" is the person the API set for this transaction. A student who isn't
-- enrolled anywhere (an instructor, for example) simply gets no lines.
CREATE VIEW api.v_my_classes WITH (security_invoker = true) AS
SELECT r.section_id,
       c.code                                       AS course_code,
       c.name                                       AS course_name,
       s.term,
       s.section_no,
       private.student_instructor_name(r.section_id) AS instructor_name,
       r.sessions_held,
       r.attended,
       r.excused,
       r.sessions_counted,
       r.rate_pct
FROM api.v_section_attendance_rate r
JOIN api.sections s ON s.id = r.section_id
JOIN api.courses c  ON c.id = s.course_id
WHERE r.student_id = private.current_user_id();

-- ---- Overview: all my classes added up, then the rule applied once ---------
-- Pooled (sum of attended / sum of counted), not the average of the class
-- rates: a class with 4 windows must not weigh as much as one with 40. This
-- always returns exactly one line; with nothing to divide by, rate_pct is NULL.
CREATE VIEW api.v_my_overview WITH (security_invoker = true) AS
SELECT coalesce(sum(sessions_held), 0)::int      AS sessions_held,
       coalesce(sum(attended), 0)::int           AS attended,
       coalesce(sum(excused), 0)::int            AS excused,
       coalesce(sum(sessions_counted), 0)::int   AS sessions_counted,
       round(100.0 * sum(attended) / NULLIF(sum(sessions_counted), 0), 1)::float8 AS rate_pct
FROM api.v_section_attendance_rate
WHERE student_id = private.current_user_id();

-- ---- Overview: my check-ins (the API takes the newest 5) -------------------
-- Only 'present' rows: an excused mark is not a check-in. No distance, no
-- accuracy and no recorded_by: the students never see GPS data.
CREATE VIEW api.v_my_recent_checkins WITH (security_invoker = true) AS
SELECT a.class_session_id,
       cs.section_id,
       c.code AS course_code,
       c.name AS course_name,
       a.recorded_at,
       a.method::text AS method
FROM api.attendance a
JOIN api.class_sessions cs ON cs.id = a.class_session_id
JOIN api.sections s        ON s.id = cs.section_id
JOIN api.courses c         ON c.id = s.course_id
WHERE a.student_id = private.current_user_id() AND a.status = 'present';

-- New objects get no rights by default. Read-only for both app roles; they
-- stay under row-level security because of security_invoker.
GRANT SELECT ON api.v_my_classes, api.v_my_overview, api.v_my_recent_checkins TO app_rw, app_ro;

-- migrate:down
DROP VIEW api.v_my_recent_checkins;
DROP VIEW api.v_my_overview;
DROP VIEW api.v_my_classes;
DROP FUNCTION private.student_instructor_name(uuid);

-- Back to the P4 definitions (CREATE OR REPLACE can't remove columns).
DROP VIEW api.v_section_attendance_rate;
CREATE VIEW api.v_section_attendance_rate WITH (security_invoker = true) AS
SELECT e.section_id,
       st.user_id                     AS student_id,
       st.student_no,
       u.full_name,
       count(cs.id)::int                                              AS sessions_held,
       (count(a.student_id) FILTER (WHERE a.status = 'present'))::int AS attended,
       (count(a.student_id) FILTER (WHERE a.status = 'excused'))::int AS excused,
       round(
           100.0 * count(a.student_id) FILTER (WHERE a.status = 'present')
           / NULLIF(count(cs.id) - count(a.student_id) FILTER (WHERE a.status = 'excused'), 0),
           1
       )::float8                                                      AS rate_pct
FROM api.enrollments e
JOIN api.students st ON st.user_id = e.student_id
JOIN api.users u     ON u.id = st.user_id
LEFT JOIN api.class_sessions cs ON cs.section_id = e.section_id
LEFT JOIN api.attendance a
       ON a.class_session_id = cs.id AND a.student_id = e.student_id
GROUP BY e.section_id, st.user_id, st.student_no, u.full_name;

DROP VIEW api.v_session_roster;
CREATE VIEW api.v_session_roster WITH (security_invoker = true) AS
SELECT cs.id                          AS class_session_id,
       cs.section_id,
       st.user_id                     AS student_id,
       st.student_no,
       u.full_name,
       COALESCE(a.status::text, 'absent') AS status,
       a.method::text                 AS method,
       a.recorded_at
FROM api.class_sessions cs
JOIN api.enrollments e  ON e.section_id = cs.section_id
JOIN api.students st    ON st.user_id = e.student_id
JOIN api.users u        ON u.id = st.user_id
LEFT JOIN api.attendance a
       ON a.class_session_id = cs.id AND a.student_id = e.student_id;

GRANT SELECT ON api.v_session_roster, api.v_section_attendance_rate TO app_rw, app_ro;
