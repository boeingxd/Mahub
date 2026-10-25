-- migrate:up
-- Task P4: the two report views (PROJECT_PLAN.md §4.2).
--
-- A view is a saved query: reports read it like a table, so the logic lives
-- here, once, and the browser never counts anything itself.
--
-- WITH (security_invoker = true) is the important part. A normal view runs
-- with its OWNER's rights, which would skip row-level security: a student
-- could read everyone's attendance through it. security_invoker makes the
-- view run as the person asking, so the policies from Y2 still apply
-- (a student sees only their own line, an instructor only their own sections).

-- One line per window and enrolled student. "absent" is never stored: it is
-- what we show when the student is enrolled but has no attendance row, which
-- is exactly what the LEFT JOIN finds (a to-be-absent student gets NULLs).
CREATE VIEW api.v_session_roster WITH (security_invoker = true) AS
SELECT cs.id                          AS class_session_id,
       cs.section_id,
       st.user_id                     AS student_id,
       st.student_no,
       u.full_name,
       COALESCE(a.status::text, 'absent') AS status,   -- present | excused | absent
       a.method::text                 AS method,       -- qr | manual | NULL when absent
       a.recorded_at
FROM api.class_sessions cs
JOIN api.enrollments e  ON e.section_id = cs.section_id
JOIN api.students st    ON st.user_id = e.student_id
JOIN api.users u        ON u.id = st.user_id
LEFT JOIN api.attendance a
       ON a.class_session_id = cs.id AND a.student_id = e.student_id;

-- One line per section and enrolled student: how many windows were held, how
-- many they attended, and the rate. An excused window doesn't count against
-- the student, so rate = attended / (held - excused). If that is 0 (no
-- windows yet, or all of them excused) there is nothing to divide by, and the
-- rate is NULL ("no rate yet"), not 0.
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

-- New objects get no rights by default (the grants in the Y2 migration only
-- covered tables that existed then). Read-only for both app roles; they stay
-- under row-level security because of security_invoker.
GRANT SELECT ON api.v_session_roster, api.v_section_attendance_rate TO app_rw, app_ro;

-- migrate:down
DROP VIEW api.v_section_attendance_rate;
DROP VIEW api.v_session_roster;
