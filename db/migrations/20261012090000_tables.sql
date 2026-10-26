-- migrate:up
-- All tables from PROJECT_PLAN.md §4.1 (task P2).
-- Grants and row-level security come later (task Y2); the audit trigger comes in P5.

-- ---------------------------------------------------------------- people
CREATE TABLE api.users (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       citext      NOT NULL UNIQUE,
    -- NULL until the first Google login; after that users are matched by sub (ADR 0007).
    google_sub  text        UNIQUE,
    full_name   text        NOT NULL CHECK (length(btrim(full_name)) > 0),
    created_at  timestamptz NOT NULL DEFAULT now()
    -- No role column and no email-domain CHECK on purpose (ADR 0007).
);

CREATE TABLE api.user_roles (
    user_id     uuid          NOT NULL REFERENCES api.users (id) ON DELETE RESTRICT,
    role        api.app_role  NOT NULL,
    -- NULL when the login policy granted 'student' automatically rather than an admin.
    granted_by  uuid          REFERENCES api.users (id) ON DELETE RESTRICT,
    granted_at  timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);
CREATE INDEX user_roles_granted_by_idx ON api.user_roles (granted_by);

CREATE TABLE api.students (
    user_id     uuid  PRIMARY KEY REFERENCES api.users (id) ON DELETE RESTRICT,
    student_no  text  NOT NULL UNIQUE CHECK (student_no ~ '^[0-9]{10}$')
);

-- --------------------------------------------------------------- teaching
CREATE TABLE api.courses (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text         NOT NULL UNIQUE,
    name         text         NOT NULL,
    archived_at  timestamptz
);

CREATE TABLE api.sections (
    id             uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id      uuid     NOT NULL REFERENCES api.courses (id) ON DELETE RESTRICT,
    term           text     NOT NULL CHECK (term ~ '^[0-9]{4}-[0-9]+$'),  -- e.g. 2026-1
    section_no     integer  NOT NULL CHECK (section_no > 0),
    instructor_id  uuid     NOT NULL REFERENCES api.users (id) ON DELETE RESTRICT,
    archived_at    timestamptz,
    UNIQUE (course_id, term, section_no)
);
CREATE INDEX sections_instructor_idx ON api.sections (instructor_id);

CREATE TABLE api.rooms (
    id        uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
    name      text                  NOT NULL UNIQUE,
    location  geography(Point, 4326) NOT NULL,
    radius_m  integer               NOT NULL CHECK (radius_m BETWEEN 10 AND 500)
);

CREATE TABLE api.enrollments (
    section_id  uuid  NOT NULL REFERENCES api.sections (id) ON DELETE RESTRICT,
    student_id  uuid  NOT NULL REFERENCES api.students (user_id) ON DELETE RESTRICT,
    PRIMARY KEY (section_id, student_id)
);
CREATE INDEX enrollments_student_idx ON api.enrollments (student_id);

-- ------------------------------------------------------------- attendance
-- A class_session is one attendance window (not a login session).
CREATE TABLE api.class_sessions (
    id          uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id  uuid                   NOT NULL REFERENCES api.sections (id) ON DELETE RESTRICT,
    room_id     uuid                   NOT NULL REFERENCES api.rooms (id) ON DELETE RESTRICT,
    -- Copied from the room when the window opens, so later room edits don't change history.
    location    geography(Point, 4326) NOT NULL,
    radius_m    integer                NOT NULL CHECK (radius_m BETWEEN 10 AND 500),
    opened_by   uuid                   NOT NULL REFERENCES api.users (id) ON DELETE RESTRICT,
    opened_at   timestamptz            NOT NULL DEFAULT now(),
    closed_at   timestamptz,
    CHECK (closed_at IS NULL OR opened_at < closed_at)
);
-- At most one open window per section.
CREATE UNIQUE INDEX class_sessions_one_open_per_section
    ON api.class_sessions (section_id) WHERE closed_at IS NULL;
CREATE INDEX class_sessions_section_idx ON api.class_sessions (section_id, opened_at DESC);
CREATE INDEX class_sessions_room_idx ON api.class_sessions (room_id);
CREATE INDEX class_sessions_opened_by_idx ON api.class_sessions (opened_by);

-- Absent = enrolled with no row here (derived in a view, task P4).
CREATE TABLE api.attendance (
    class_session_id  uuid                  NOT NULL REFERENCES api.class_sessions (id) ON DELETE RESTRICT,
    student_id        uuid                  NOT NULL REFERENCES api.students (user_id) ON DELETE RESTRICT,
    status            api.attendance_status NOT NULL DEFAULT 'present',
    method            api.attendance_method NOT NULL,
    recorded_at       timestamptz           NOT NULL DEFAULT now(),
    recorded_by       uuid                  REFERENCES api.users (id) ON DELETE RESTRICT,
    -- Privacy (ADR 0006): distances only, never raw latitude/longitude.
    distance_m        real                  CHECK (distance_m >= 0),
    gps_accuracy_m    real                  CHECK (gps_accuracy_m >= 0),
    PRIMARY KEY (class_session_id, student_id),
    -- A manual mark must say who made it.
    CHECK (method <> 'manual' OR recorded_by IS NOT NULL)
);
CREATE INDEX attendance_student_idx ON api.attendance (student_id);
CREATE INDEX attendance_recorded_by_idx ON api.attendance (recorded_by);

CREATE TABLE api.checkin_attempts (
    id                uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id  uuid                NOT NULL REFERENCES api.class_sessions (id) ON DELETE RESTRICT,
    user_id           uuid                NOT NULL REFERENCES api.users (id) ON DELETE RESTRICT,
    at                timestamptz         NOT NULL DEFAULT now(),
    outcome           api.attempt_outcome NOT NULL,
    distance_m        real                CHECK (distance_m >= 0),
    gps_accuracy_m    real                CHECK (gps_accuracy_m >= 0)
);
CREATE INDEX checkin_attempts_session_idx ON api.checkin_attempts (class_session_id, at);
CREATE INDEX checkin_attempts_user_idx ON api.checkin_attempts (user_id, at);

-- ------------------------------------------------------------------ audit
-- Append-only log. The trigger that fills it and the grants are in the P5 migration (audit_trigger).
CREATE TABLE audit.events (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    actor       uuid,
    table_name  text        NOT NULL,
    op          text        NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
    row_pk      text        NOT NULL,
    before      jsonb,
    after       jsonb
);
CREATE INDEX audit_events_table_at_idx ON audit.events (table_name, at);

-- migrate:down
DROP TABLE audit.events;
DROP TABLE api.checkin_attempts;
DROP TABLE api.attendance;
DROP TABLE api.class_sessions;
DROP TABLE api.enrollments;
DROP TABLE api.rooms;
DROP TABLE api.sections;
DROP TABLE api.courses;
DROP TABLE api.students;
DROP TABLE api.user_roles;
DROP TABLE api.users;
