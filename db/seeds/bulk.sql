-- Bulk fake data for performance tests (task P6): roughly what one term at a
-- big university looks like. NEVER load this into your everyday `mahub`
-- database. Use a throwaway one (see docs/PERFORMANCE.md).
--
--   2,000 students (6722900000 ... 6722901999), 10 courses, 20 sections
--   ~200 students per section (every student is in 2 sections)  -> 4,000 enrollments
--   15 attendance windows per section                           -> 300 windows
--   ~85% of enrolled students present per window               -> ~50,000 attendance rows
--   ~60,000 check-in log rows
--
-- Run it AFTER `dbmate up` and db/seeds/seed.sql (it reuses the two seeded
-- instructors and rooms):
--   docker compose exec -T db psql -U postgres -d mahub_perf -v ON_ERROR_STOP=1 < db/seeds/bulk.sql
--
-- generate_series(1, n) makes the numbers 1..n as rows, the easy way to
-- invent lots of rows in one INSERT. random() makes the data look uneven.

-- ---- students ----------------------------------------------------------
INSERT INTO api.users (email, full_name)
SELECT '67229' || lpad(n::text, 5, '0') || '@g.siit.tu.ac.th', 'Bulk Student ' || n
FROM generate_series(0, 1999) AS n
ON CONFLICT (email) DO NOTHING;

INSERT INTO api.students (user_id, student_no)
SELECT id, split_part(email::text, '@', 1)
FROM api.users WHERE email::text LIKE '67229%@g.siit.tu.ac.th'
ON CONFLICT DO NOTHING;

INSERT INTO api.user_roles (user_id, role)
SELECT user_id, 'student' FROM api.students WHERE student_no LIKE '67229%'
ON CONFLICT DO NOTHING;

-- ---- courses and sections ----------------------------------------------
INSERT INTO api.courses (code, name)
SELECT 'BLK' || (100 + n), 'Bulk course ' || n FROM generate_series(1, 10) AS n
ON CONFLICT (code) DO NOTHING;

-- Two sections per bulk course; the seeded instructors take turns.
INSERT INTO api.sections (course_id, term, section_no, instructor_id)
SELECT c.id, '2026-1', s.n,
       CASE WHEN (row_number() OVER (ORDER BY c.code, s.n)) % 2 = 0
            THEN '00000000-0000-0000-0000-0000000000b1'::uuid
            ELSE '00000000-0000-0000-0000-0000000000b2'::uuid END
FROM api.courses c CROSS JOIN generate_series(1, 2) AS s(n)
WHERE c.code LIKE 'BLK%'
ON CONFLICT DO NOTHING;

-- ---- enrollments: student k joins bulk section (k mod 20) and (k+7 mod 20) ----
WITH numbered_students AS (
    SELECT user_id, (row_number() OVER (ORDER BY student_no)) - 1 AS k
    FROM api.students WHERE student_no LIKE '67229%'
), numbered_sections AS (
    SELECT s.id, (row_number() OVER (ORDER BY c.code, s.section_no)) - 1 AS j
    FROM api.sections s JOIN api.courses c ON c.id = s.course_id
    WHERE c.code LIKE 'BLK%'
)
INSERT INTO api.enrollments (section_id, student_id)
SELECT sec.id, st.user_id
FROM numbered_students st
JOIN numbered_sections sec ON sec.j IN (st.k % 20, (st.k + 7) % 20)
ON CONFLICT DO NOTHING;

-- ---- attendance windows: 15 per section, weekly, the newest one still open ----
INSERT INTO api.class_sessions (section_id, room_id, location, radius_m, opened_by, opened_at, closed_at)
SELECT s.id, r.id, r.location, r.radius_m, s.instructor_id,
       now() - make_interval(days => 7 * (15 - w.n) + 1),
       CASE WHEN w.n = 15 THEN NULL
            ELSE now() - make_interval(days => 7 * (15 - w.n) + 1) + interval '20 minutes' END
FROM api.sections s
JOIN api.courses c ON c.id = s.course_id AND c.code LIKE 'BLK%'
CROSS JOIN generate_series(1, 15) AS w(n)
JOIN api.rooms r ON r.name = 'SIIT Building A, Room 101'
WHERE NOT EXISTS (SELECT 1 FROM api.class_sessions x WHERE x.section_id = s.id);

-- ---- attendance: ~85% of enrolled students, mostly QR, a few manual/excused ----
-- random() sits in a subquery's select list so it is drawn once PER ROW (a
-- random() with no link to a row would be drawn once for the whole query).
INSERT INTO api.attendance (class_session_id, student_id, status, method, recorded_at, recorded_by, distance_m, gps_accuracy_m)
SELECT p.class_session_id, p.student_id,
       CASE WHEN p.x < 0.03 THEN 'excused' ELSE 'present' END::api.attendance_status,
       CASE WHEN p.x < 0.05 THEN 'manual' ELSE 'qr' END::api.attendance_method,
       p.opened_at + interval '3 minutes',
       CASE WHEN p.x < 0.05 THEN p.opened_by END,
       CASE WHEN p.x >= 0.05 THEN round((random() * 40)::numeric, 1)::real END,
       CASE WHEN p.x >= 0.05 THEN round((5 + random() * 20)::numeric, 1)::real END
FROM (
    SELECT cs.id AS class_session_id, e.student_id, cs.opened_at, cs.opened_by, random() AS x
    FROM api.class_sessions cs
    JOIN api.sections s ON s.id = cs.section_id
    JOIN api.courses c ON c.id = s.course_id AND c.code LIKE 'BLK%'
    JOIN api.enrollments e ON e.section_id = cs.section_id
) p
WHERE p.x < 0.85
ON CONFLICT DO NOTHING;

-- ---- check-in log: one row per attendance, plus some failed attempts -----
INSERT INTO api.checkin_attempts (class_session_id, user_id, at, outcome, distance_m, gps_accuracy_m)
SELECT a.class_session_id, a.student_id, a.recorded_at, 'ok', a.distance_m, a.gps_accuracy_m
FROM api.attendance a
JOIN api.class_sessions cs ON cs.id = a.class_session_id
JOIN api.sections s ON s.id = cs.section_id
JOIN api.courses c ON c.id = s.course_id AND c.code LIKE 'BLK%'
WHERE a.method = 'qr';

INSERT INTO api.checkin_attempts (class_session_id, user_id, at, outcome, distance_m, gps_accuracy_m)
SELECT cs.id, e.student_id, cs.opened_at + interval '2 minutes',
       (ARRAY['bad_qr', 'out_of_range', 'already_present'])[1 + floor(random() * 3)::int]::api.attempt_outcome,
       round((random() * 200)::numeric, 1)::real, 10
FROM api.class_sessions cs
JOIN api.sections s ON s.id = cs.section_id
JOIN api.courses c ON c.id = s.course_id AND c.code LIKE 'BLK%'
JOIN api.enrollments e ON e.section_id = cs.section_id
WHERE random() < 0.2;

-- Fresh statistics: the planner picks plans from table statistics, and
-- these tables just grew from a few rows to tens of thousands.
ANALYZE;
