-- 300 fake students for the k6 load test (task B8). Run it AFTER `dbmate up`
-- and db/seeds/seed.sql, on a throwaway or local database only:
--   docker compose exec -T db psql -U postgres -d mahub -v ON_ERROR_STOP=1 < load/seed.sql
-- They join ITS332 section 1 (the seeded section e1), taught by the seeded
-- instructor1. Safe to run twice. Delete them with load/cleanup.sql.
INSERT INTO api.users (email, full_name)
SELECT '67300' || lpad(n::text, 5, '0') || '@g.siit.tu.ac.th', 'Load Student ' || n
FROM generate_series(0, 299) AS n
ON CONFLICT (email) DO NOTHING;

INSERT INTO api.students (user_id, student_no)
SELECT id, split_part(email::text, '@', 1)
FROM api.users WHERE email::text LIKE '67300%@g.siit.tu.ac.th'
ON CONFLICT DO NOTHING;

INSERT INTO api.user_roles (user_id, role)
SELECT user_id, 'student' FROM api.students WHERE student_no LIKE '67300%'
ON CONFLICT DO NOTHING;

INSERT INTO api.enrollments (section_id, student_id)
SELECT '00000000-0000-0000-0000-0000000000e1', user_id
FROM api.students WHERE student_no LIKE '67300%'
ON CONFLICT DO NOTHING;
