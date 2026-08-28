-- ClickHouse (OLAP): append-only event log for check-ins, assessments, and attendance.

CREATE TABLE IF NOT EXISTS events (
    event_id UUID DEFAULT generateUUIDv4(),
    event_type LowCardinality(String),
    event_time DateTime DEFAULT now(),
    student_id Int32,
    teacher_id Int32,
    value Nullable(Float64),
    metadata String DEFAULT '',
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (event_type, event_time);
