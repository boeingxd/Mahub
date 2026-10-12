# Entity-relationship diagram

Tables from `db/migrations/20261012090000_tables.sql`. Attendance "absent" is not a row: it is an enrolled student with no `attendance` row (a view, task P4).

```mermaid
erDiagram
    users ||--o{ user_roles : "has"
    users ||--o| students : "is"
    users ||--o{ sections : "teaches"
    courses ||--o{ sections : "has"
    sections ||--o{ enrollments : "has"
    students ||--o{ enrollments : "joins"
    sections ||--o{ class_sessions : "opens"
    rooms ||--o{ class_sessions : "hosts"
    users ||--o{ class_sessions : "opened_by"
    class_sessions ||--o{ attendance : "records"
    students ||--o{ attendance : "has"
    class_sessions ||--o{ checkin_attempts : "logs"
    users ||--o{ checkin_attempts : "makes"

    users { uuid id PK "email citext unique, google_sub unique null, full_name" }
    user_roles { uuid user_id PK "role app_role PK, granted_by null" }
    students { uuid user_id PK "student_no unique 10 digits" }
    courses { uuid id PK "code unique" }
    sections { uuid id PK "course_id, term, section_no, instructor_id" }
    rooms { uuid id PK "location geography, radius_m 10-500" }
    enrollments { uuid section_id PK "student_id PK" }
    class_sessions { uuid id PK "geofence copied from room; one open per section" }
    attendance { uuid class_session_id PK "student_id PK, status, method, distance_m" }
    checkin_attempts { uuid id PK "outcome, distance_m" }
```

`audit.events` is separate: it is filled by triggers (task P5) and has no foreign keys.
