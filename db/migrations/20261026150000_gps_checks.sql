-- migrate:up
-- Task Y6, old bug 2 (the lat: "x" NaN bypass), at the database level.
--
-- The first CHECKs were "distance_m >= 0". In Postgres, NaN counts as LARGER
-- than every number, and so does Infinity, so both passed "NaN >= 0". These
-- CHECKs also need "< 'Infinity'", which refuses Infinity and NaN alike.
-- The accuracy limit matches the API's zod limit (0..5000 m).
-- NULL still passes (a manual mark has no distance).
ALTER TABLE api.attendance
    DROP CONSTRAINT attendance_distance_m_check,
    DROP CONSTRAINT attendance_gps_accuracy_m_check,
    ADD CONSTRAINT attendance_distance_m_check CHECK (distance_m >= 0 AND distance_m < 'Infinity'),
    ADD CONSTRAINT attendance_gps_accuracy_m_check CHECK (gps_accuracy_m BETWEEN 0 AND 5000);

ALTER TABLE api.checkin_attempts
    DROP CONSTRAINT checkin_attempts_distance_m_check,
    DROP CONSTRAINT checkin_attempts_gps_accuracy_m_check,
    ADD CONSTRAINT checkin_attempts_distance_m_check CHECK (distance_m >= 0 AND distance_m < 'Infinity'),
    ADD CONSTRAINT checkin_attempts_gps_accuracy_m_check CHECK (gps_accuracy_m BETWEEN 0 AND 5000);

-- migrate:down
ALTER TABLE api.attendance
    DROP CONSTRAINT attendance_distance_m_check,
    DROP CONSTRAINT attendance_gps_accuracy_m_check,
    ADD CONSTRAINT attendance_distance_m_check CHECK (distance_m >= 0),
    ADD CONSTRAINT attendance_gps_accuracy_m_check CHECK (gps_accuracy_m >= 0);

ALTER TABLE api.checkin_attempts
    DROP CONSTRAINT checkin_attempts_distance_m_check,
    DROP CONSTRAINT checkin_attempts_gps_accuracy_m_check,
    ADD CONSTRAINT checkin_attempts_distance_m_check CHECK (distance_m >= 0),
    ADD CONSTRAINT checkin_attempts_gps_accuracy_m_check CHECK (gps_accuracy_m >= 0);
