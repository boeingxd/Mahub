-- migrate:up
-- Task Y3: the QR scan endpoint must check "is this check-in window still
-- open?" before the student has signed in, when row-level security would hide
-- every class_session. This function answers only that yes/no question.
CREATE FUNCTION private.class_session_is_open(p_class_session_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, private
AS $$
    SELECT EXISTS (
        SELECT 1 FROM api.class_sessions WHERE id = p_class_session_id AND closed_at IS NULL)
$$;

ALTER FUNCTION private.class_session_is_open(uuid) OWNER TO rls_definer;
REVOKE EXECUTE ON FUNCTION private.class_session_is_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.class_session_is_open(uuid) TO app_rw;

-- migrate:down
DROP FUNCTION private.class_session_is_open(uuid);
