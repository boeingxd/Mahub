-- Development seed data (fake people, real-ish places). Safe to run more than once.
-- Run (after `dbmate up`):
--   docker compose exec -T db psql -U postgres -d mahub -v ON_ERROR_STOP=1 < db/seeds/seed.sql
-- PowerShell: Get-Content db/seeds/seed.sql -Raw | docker compose exec -T db psql -U postgres -d mahub -v ON_ERROR_STOP=1

-- ---- people ------------------------------------------------------------
INSERT INTO api.users (id, email, full_name) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com',       'Dev Admin'),
    ('00000000-0000-0000-0000-0000000000b1', 'instructor1@example.com', 'Dev Instructor One'),
    ('00000000-0000-0000-0000-0000000000b2', 'instructor2@example.com', 'Dev Instructor Two')
ON CONFLICT (email) DO NOTHING;

INSERT INTO api.user_roles (user_id, role, granted_by) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'admin',      NULL),
    ('00000000-0000-0000-0000-0000000000b1', 'instructor', '00000000-0000-0000-0000-0000000000a1'),
    ('00000000-0000-0000-0000-0000000000b2', 'instructor', '00000000-0000-0000-0000-0000000000a1')
ON CONFLICT DO NOTHING;

-- 30 students. The first three are real team accounts so they can sign in during testing;
-- the other 27 are fake (6722780001 ... 6722780027).
CREATE TEMP TABLE IF NOT EXISTS seed_students (student_no text, full_name text);
TRUNCATE seed_students;
INSERT INTO seed_students VALUES
    ('6722771886', 'Pinya (postscrippt)'),
    ('6722781026', 'Yayikast'),
    ('6722782164', 'Boeing (Boeingxd)');
INSERT INTO seed_students
SELECT '67227800' || lpad(n::text, 2, '0'), 'Student ' || n FROM generate_series(1, 27) AS n;

INSERT INTO api.users (id, email, full_name)
SELECT gen_random_uuid(), student_no || '@g.siit.tu.ac.th', full_name FROM seed_students
ON CONFLICT (email) DO NOTHING;

INSERT INTO api.students (user_id, student_no)
SELECT u.id, s.student_no
FROM seed_students s JOIN api.users u ON u.email = s.student_no || '@g.siit.tu.ac.th'
ON CONFLICT DO NOTHING;

-- granted_by is NULL: the login policy gives the student role, not an admin.
INSERT INTO api.user_roles (user_id, role)
SELECT u.id, 'student'
FROM seed_students s JOIN api.users u ON u.email = s.student_no || '@g.siit.tu.ac.th'
ON CONFLICT DO NOTHING;

-- ---- teaching ----------------------------------------------------------
INSERT INTO api.courses (id, code, name) VALUES
    ('00000000-0000-0000-0000-0000000000d1', 'ITS332', 'Database Systems'),
    ('00000000-0000-0000-0000-0000000000d2', 'ITS323', 'Computer Networks')
ON CONFLICT (code) DO NOTHING;

INSERT INTO api.sections (id, course_id, term, section_no, instructor_id) VALUES
    ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', '2026-1', 1, '00000000-0000-0000-0000-0000000000b1'),
    ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', '2026-1', 2, '00000000-0000-0000-0000-0000000000b2'),
    ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', '2026-1', 1, '00000000-0000-0000-0000-0000000000b1')
ON CONFLICT DO NOTHING;

-- SIIT Bangkadi campus, Pathum Thani. Point is (longitude, latitude).
-- Approximate building positions: check them on a map and adjust before the demo.
INSERT INTO api.rooms (id, name, location, radius_m) VALUES
    ('00000000-0000-0000-0000-0000000000f1', 'SIIT Building A, Room 101',
     ST_SetSRID(ST_MakePoint(100.6150, 14.0690), 4326)::geography, 50),
    ('00000000-0000-0000-0000-0000000000f2', 'SIIT Building B, Room 201',
     ST_SetSRID(ST_MakePoint(100.6160, 14.0685), 4326)::geography, 50)
ON CONFLICT (name) DO NOTHING;

-- Section 1 of ITS332: all 30 students. Section 2: the first 15. ITS323 section 1: the last 15.
INSERT INTO api.enrollments (section_id, student_id)
SELECT '00000000-0000-0000-0000-0000000000e1', user_id FROM api.students
ON CONFLICT DO NOTHING;

INSERT INTO api.enrollments (section_id, student_id)
SELECT '00000000-0000-0000-0000-0000000000e2', user_id
FROM (SELECT user_id, row_number() OVER (ORDER BY student_no) AS n FROM api.students) s WHERE n <= 15
ON CONFLICT DO NOTHING;

INSERT INTO api.enrollments (section_id, student_id)
SELECT '00000000-0000-0000-0000-0000000000e3', user_id
FROM (SELECT user_id, row_number() OVER (ORDER BY student_no) AS n FROM api.students) s WHERE n > 15
ON CONFLICT DO NOTHING;
