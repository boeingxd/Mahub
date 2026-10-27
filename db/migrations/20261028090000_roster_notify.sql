-- migrate:up
-- Task B5: tell the API the moment an attendance row is written, so the
-- instructor's roster can update without a page refresh.
--
-- pg_notify('roster', text) is Postgres's broadcast: every connection that ran
-- `LISTEN roster` gets the text, but only when the writing transaction COMMITS
-- (a rolled-back check-in sends nothing). The message holds ids and the status
-- only: no name, no email, no GPS (ADR 0006). The API decides who may see it.
--
-- NEVER put anything private in this payload. Postgres has no permission for
-- LISTEN: any database role that can connect hears every 'roster' message. The
-- rule is "nothing you wouldn't show every database role".
--
-- Payload (also in docs/API.md):
--   {"class_session_id": "<uuid>", "student_id": "<uuid>", "status": "present" | "excused"}
-- An 8000-byte limit applies to NOTIFY payloads; this is about 130 bytes.
CREATE FUNCTION private.notify_roster() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM pg_notify(
        'roster',
        jsonb_build_object(
            'class_session_id', NEW.class_session_id,
            'student_id', NEW.student_id,
            'status', NEW.status
        )::text
    );
    RETURN NULL;  -- an AFTER trigger's return value is ignored
END
$$;

-- Not SECURITY DEFINER: it only broadcasts, which every role may do, so it runs
-- with the caller's rights. The caller (app_rw) still needs to be allowed to run it.
GRANT EXECUTE ON FUNCTION private.notify_roster() TO app_rw;

CREATE TRIGGER notify_roster AFTER INSERT OR UPDATE ON api.attendance
    FOR EACH ROW EXECUTE FUNCTION private.notify_roster();

-- migrate:down
DROP TRIGGER notify_roster ON api.attendance;
DROP FUNCTION private.notify_roster();
