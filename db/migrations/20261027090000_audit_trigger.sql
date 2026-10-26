-- migrate:up
-- Task P5: an append-only log of every change to roles, enrollments and attendance.
-- A trigger is a function Postgres runs by itself after each INSERT/UPDATE/DELETE
-- on a table, so no API code can forget to write the log (or choose not to).

-- The tables migration made row_pk text. A primary key can have several columns
-- (user_id + role), so jsonb fits better: {"user_id": "...", "role": "admin"}.
-- The table is empty at this point, so the conversion is safe.
ALTER TABLE audit.events ALTER COLUMN row_pk TYPE jsonb USING to_jsonb(row_pk);

-- The trigger function runs as this role instead of as the caller, because the
-- caller (app_rw) must NOT be able to write to audit.events directly.
-- NOLOGIN: nobody can sign in as it. It gets only what the function needs.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_definer') THEN
        CREATE ROLE audit_definer NOLOGIN;
    END IF;
END
$$;
GRANT USAGE ON SCHEMA audit, private TO audit_definer;
GRANT INSERT ON audit.events TO audit_definer;
GRANT EXECUTE ON FUNCTION private.current_user_id() TO audit_definer;

-- One function for all three tables. The primary key column names come in as
-- trigger arguments (TG_ARGV), e.g. log_change('user_id', 'role').
-- SECURITY DEFINER + SET search_path = pg_catalog, private: it runs with
-- audit_definer's rights and cannot be tricked into calling look-alike
-- functions the caller created. Every name below is written in full.
CREATE FUNCTION audit.log_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
DECLARE
    old_row jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
    new_row jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
    pk      jsonb := '{}';
    col     text;
BEGIN
    FOREACH col IN ARRAY TG_ARGV LOOP
        pk := pk || jsonb_build_object(col, coalesce(new_row, old_row) -> col);
    END LOOP;

    INSERT INTO audit.events (actor, table_name, op, row_pk, before, after)
    VALUES (private.current_user_id(), TG_TABLE_NAME, TG_OP, pk, old_row, new_row);
    RETURN NULL;  -- an AFTER trigger's return value is ignored
END
$$;
ALTER FUNCTION audit.log_change() OWNER TO audit_definer;
REVOKE EXECUTE ON FUNCTION audit.log_change() FROM PUBLIC;

CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON api.user_roles
    FOR EACH ROW EXECUTE FUNCTION audit.log_change('user_id', 'role');
CREATE TRIGGER audit_attendance AFTER INSERT OR UPDATE OR DELETE ON api.attendance
    FOR EACH ROW EXECUTE FUNCTION audit.log_change('class_session_id', 'student_id');
CREATE TRIGGER audit_enrollments AFTER INSERT OR UPDATE OR DELETE ON api.enrollments
    FOR EACH ROW EXECUTE FUNCTION audit.log_change('section_id', 'student_id');

-- Append-only: nobody changes or removes a log row. (These rights were never
-- granted; revoking them states the rule in the schema, and survives a careless
-- future GRANT ALL.) Only the auditor reads the log; app_rw and app_ro cannot.
REVOKE ALL ON audit.events FROM PUBLIC, app_rw, app_ro;
REVOKE USAGE ON SCHEMA audit FROM PUBLIC, app_rw, app_ro;
GRANT SELECT ON audit.events TO auditor;

-- migrate:down
DROP TRIGGER audit_enrollments ON api.enrollments;
DROP TRIGGER audit_attendance ON api.attendance;
DROP TRIGGER audit_user_roles ON api.user_roles;
DROP FUNCTION audit.log_change();
REVOKE ALL ON audit.events FROM audit_definer;
REVOKE ALL ON FUNCTION private.current_user_id() FROM audit_definer;
REVOKE USAGE ON SCHEMA audit, private FROM audit_definer;
DROP ROLE audit_definer;
ALTER TABLE audit.events ALTER COLUMN row_pk TYPE text USING row_pk::text;
