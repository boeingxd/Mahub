-- Development seed data. Safe to run more than once.
-- Run: docker compose exec -T db psql -U postgres -d mahub < db/seeds/dev.sql

INSERT INTO api.users (id, email, full_name) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com',      'Dev Admin'),
    ('00000000-0000-0000-0000-0000000000b1', 'instructor@example.com', 'Dev Instructor'),
    ('00000000-0000-0000-0000-0000000000c1', '6722781026@g.siit.tu.ac.th', 'Dev Student')
ON CONFLICT (email) DO NOTHING;

INSERT INTO api.user_roles (user_id, role, granted_by) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'admin',      NULL),
    ('00000000-0000-0000-0000-0000000000b1', 'instructor', '00000000-0000-0000-0000-0000000000a1'),
    ('00000000-0000-0000-0000-0000000000c1', 'student',    NULL)
ON CONFLICT DO NOTHING;

INSERT INTO api.students (user_id, student_no) VALUES
    ('00000000-0000-0000-0000-0000000000c1', '6722781026')
ON CONFLICT DO NOTHING;

INSERT INTO api.courses (id, code, name) VALUES
    ('00000000-0000-0000-0000-0000000000d1', 'ITS332', 'Database Systems')
ON CONFLICT (code) DO NOTHING;

INSERT INTO api.sections (id, course_id, term, section_no, instructor_id) VALUES
    ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1',
     '2026-1', 1, '00000000-0000-0000-0000-0000000000b1')
ON CONFLICT DO NOTHING;

-- Placeholder coordinates (SIIT Bangkadi area); point is (longitude, latitude).
INSERT INTO api.rooms (id, name, location, radius_m) VALUES
    ('00000000-0000-0000-0000-0000000000f1', 'Dev Room 101',
     ST_SetSRID(ST_MakePoint(100.6165, 14.0680), 4326)::geography, 50)
ON CONFLICT (name) DO NOTHING;

INSERT INTO api.enrollments (section_id, student_id) VALUES
    ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1')
ON CONFLICT DO NOTHING;
