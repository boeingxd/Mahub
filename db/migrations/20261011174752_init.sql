-- migrate:up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA api;
CREATE SCHEMA private;
CREATE SCHEMA audit;

CREATE TYPE api.app_role AS ENUM (
    'student',
    'instructor',
    'admin'
);

CREATE TYPE api.attendance_status AS ENUM (
    'present',
    'excused'
);

CREATE TYPE api.attendance_method AS ENUM (
    'qr',
    'manual'
);

CREATE TYPE api.attempt_outcome AS ENUM (
    'ok',
    'bad_qr',
    'not_enrolled',
    'session_closed',
    'out_of_range',
    'already_present'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'migrator'
    ) THEN
        CREATE ROLE migrator NOLOGIN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'app_rw'
    ) THEN
        CREATE ROLE app_rw NOLOGIN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'app_ro'
    ) THEN
        CREATE ROLE app_ro NOLOGIN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'auditor'
    ) THEN
        CREATE ROLE auditor NOLOGIN;
    END IF;
END
$$;

-- migrate:down
DROP ROLE IF EXISTS auditor;
DROP ROLE IF EXISTS app_ro;
DROP ROLE IF EXISTS app_rw;
DROP ROLE IF EXISTS migrator;
DROP TYPE api.attempt_outcome;
DROP TYPE api.attendance_method;
DROP TYPE api.attendance_status;
DROP TYPE api.app_role;

DROP SCHEMA audit;
DROP SCHEMA private;
DROP SCHEMA api;

DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
DROP EXTENSION IF EXISTS postgis;
